import { inflateRawSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { readStudy, writeStudy } from "./study.ts";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 1_000_000;

function decodeXml(value: string): string {
	return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
		const names: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
		if (names[code]) return names[code];
		const point = code.startsWith("#x") ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
		return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
	});
}

/** Read only the requested XML entries; never extract archive paths to disk. */
function officeEntries(bytes: Buffer, match: RegExp): Array<{ name: string; xml: string }> {
	let end = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
		if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
	}
	if (end < 0) throw new Error("This Office file is not a readable archive.");
	const count = bytes.readUInt16LE(end + 10);
	const central = bytes.readUInt32LE(end + 16);
	if (count > 4000 || central >= bytes.length) throw new Error("This Office file is too complex to import.");
	let offset = central;
	let total = 0;
	const entries: Array<{ name: string; xml: string }> = [];
	for (let i = 0; i < count; i++) {
		if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("This Office file is damaged.");
		const flags = bytes.readUInt16LE(offset + 8);
		const method = bytes.readUInt16LE(offset + 10);
		const compressed = bytes.readUInt32LE(offset + 20);
		const uncompressed = bytes.readUInt32LE(offset + 24);
		const nameLength = bytes.readUInt16LE(offset + 28);
		const extraLength = bytes.readUInt16LE(offset + 30);
		const commentLength = bytes.readUInt16LE(offset + 32);
		const local = bytes.readUInt32LE(offset + 42);
		if (offset + 46 + nameLength + extraLength + commentLength > bytes.length) throw new Error("This Office file is damaged.");
		const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
		offset += 46 + nameLength + extraLength + commentLength;
		if (!match.test(name)) continue;
		total += uncompressed;
		if ((flags & 1) || total > 8_000_000 || uncompressed > 8_000_000 || ![0, 8].includes(method) ||
			local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error("This Office file cannot be safely unpacked.");
		const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
		if (dataStart + compressed > bytes.length) throw new Error("This Office file is damaged.");
		const data = bytes.subarray(dataStart, dataStart + compressed);
		const unpacked = method === 8 ? inflateRawSync(data, { maxOutputLength: 8_000_000 }) : data;
		if (unpacked.length !== uncompressed) throw new Error("This Office file is damaged.");
		entries.push({ name, xml: unpacked.toString("utf8") });
	}
	return entries;
}

function xmlParagraphs(xml: string, paragraph: string, run: string): string {
	const blocks = xml.match(new RegExp(`<${paragraph}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${paragraph}>`, "g")) ?? [];
	return blocks.map((block) => Array.from(block.matchAll(new RegExp(`<${run}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${run}>`, "g")), (m) => decodeXml(m[1]!)).join("")).filter(Boolean).join("\n");
}

function cleanTranscript(text: string): string {
	return text.replace(/^\uFEFF/, "").split(/\r?\n/)
		.filter((line) => !/^\s*(?:WEBVTT|NOTE\b|\d+\s*$|(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->)/i.test(line))
		.map((line) => line.replace(/<\/?(?:v|c|i|b|u)(?:\s[^>]*)?>/gi, "").trim())
		.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractStudyMaterial(file: File): Promise<string> {
	if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Choose a file smaller than 20 MB.");
	const name = file.name.toLowerCase();
	const data = Buffer.from(await file.arrayBuffer());
	let text: string;
	if (name.endsWith(".pdf")) {
		const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
		const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
		try {
			const document = await task.promise;
			if (document.numPages > 300) throw new Error("PDFs can contain at most 300 pages.");
			const pages: string[] = [];
			for (let n = 1; n <= document.numPages; n++) {
				const page = await document.getPage(n);
				const content = await page.getTextContent();
				pages.push(content.items.map((item) => "str" in item ? item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ") : "").join(""));
				if (pages.join("").length > MAX_TEXT) throw new Error("Extracted text is too large (over one million characters).");
			}
			text = pages.join("\n\n").trim();
		} finally { await task.destroy(); }
	} else if (name.endsWith(".docx")) {
		const entry = officeEntries(data, /^word\/document\.xml$/)[0];
		text = entry ? xmlParagraphs(entry.xml, "w:p", "w:t") : "";
	} else if (name.endsWith(".pptx")) {
		const slides = officeEntries(data, /^ppt\/slides\/slide\d+\.xml$/)
			.sort((a, b) => Number(a.name.match(/slide(\d+)/)?.[1]) - Number(b.name.match(/slide(\d+)/)?.[1]));
		text = slides.map((slide, i) => `Slide ${i + 1}\n${xmlParagraphs(slide.xml, "a:p", "a:t")}`).join("\n\n");
	} else if (/\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(name)) {
		text = "";
	} else if (/\.(txt|md|markdown|csv|tsv|vtt|srt|json|js|ts|py)$/i.test(name)) {
		text = data.toString("utf8");
		if (/\.(vtt|srt)$/i.test(name)) text = cleanTranscript(text);
	} else {
		throw new Error("Use PDF, DOCX, PPTX, an image, text, Markdown, CSV, code, or an exported VTT/SRT transcript.");
	}
	if (!text.trim() && !/\.(pdf|docx|pptx|png|jpg|jpeg|webp|gif|bmp)$/i.test(name)) throw new Error("No text was found in this file.");
	if (text.length > MAX_TEXT) throw new Error("Extracted text is too large (over one million characters).");
	return text.trim();
}

function materialPaths(id: string, extension: string) {
	if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\.[a-z0-9]{1,10}$/.test(extension)) throw new Error("Invalid material identifier.");
	const directory = path.join(PATHS.data, "materials");
	return { original: path.join(directory, id + extension), extracted: path.join(directory, id + ".txt"), directory };
}

/** The original and extracted text are written before the revision-checked
 * metadata commit; failed commits remove only the newly-created files. */
export async function addStudyMaterial(file: File, revision: number) {
	if (readStudy().revision !== revision) return null;
	const text = await extractStudyMaterial(file);
	const id = randomUUID();
	const extension = path.extname(file.name).toLowerCase();
	const paths = materialPaths(id, extension);
	fs.mkdirSync(paths.directory, { recursive: true });
	const material = { id, name: file.name, text, createdAt: new Date().toISOString(), originalExtension: extension };
	let committed = false;
	const created: string[] = [];
	try {
		fs.writeFileSync(paths.original, Buffer.from(await file.arrayBuffer()), { flag: "wx", mode: 0o600 });
		created.push(paths.original);
		// A .txt source already is its original; keep the normalized text under a distinct name.
		const extracted = extension === ".txt" ? path.join(paths.directory, id + ".extracted.txt") : paths.extracted;
		fs.writeFileSync(extracted, text, { flag: "wx", mode: 0o600 });
		created.push(extracted);
		const current = readStudy();
		if (current.revision !== revision) return null;
		const saved = writeStudy({ ...current, materials: [...current.materials, material] });
		committed = saved !== null;
		return saved;
	} finally {
		if (!committed) {
			for (const filePath of created) {
				try { fs.unlinkSync(filePath); } catch { /* no file was created */ }
			}
		}
	}
}

export function studyMaterialPaths(id: string) {
	const material = readStudy().materials.find((item) => item.id === id);
	if (!material?.originalExtension) return null;
	const paths = materialPaths(material.id, material.originalExtension);
	const extracted = material.originalExtension === ".txt" ? path.join(paths.directory, id + ".extracted.txt") : paths.extracted;
	if (!fs.existsSync(paths.original) || !fs.existsSync(extracted)) throw new Error("The saved file is missing from the local library.");
	return { original: paths.original, extracted };
}

export function deleteStudyMaterial(id: string, revision: number) {
	const current = readStudy();
	if (current.revision !== revision) return null;
	const material = current.materials.find((item) => item.id === id);
	if (!material) throw new Error("This material no longer exists.");
	const paths = material.originalExtension ? materialPaths(id, material.originalExtension) : null;
	const saved = writeStudy({ ...current, materials: current.materials.filter((item) => item.id !== id) });
	if (!saved) return null;
	let cleanupFailed = false;
	if (material.originalExtension && paths) {
		for (const filePath of [paths.original, material.originalExtension === ".txt" ? path.join(paths.directory, id + ".extracted.txt") : paths.extracted]) {
			try { fs.unlinkSync(filePath); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupFailed = true; }
		}
	}
	return { data: saved, cleanupFailed };
}
