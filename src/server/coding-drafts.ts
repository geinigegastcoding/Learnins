import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PATHS } from "../../config.ts";

const languages = z.object({
	javascript: z.string().max(100_000),
	typescript: z.string().max(100_000),
	python: z.string().max(100_000),
}).strict();
const schema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), drafts: languages, tests: languages }).strict();
export type CodingDrafts = z.infer<typeof schema>;
const file = path.join(PATHS.data, "coding-drafts.json");
export const parseCodingDrafts = (value: unknown): CodingDrafts => schema.parse(value);

/** Missing is distinct from corrupt: never replace a file that cannot be read. */
export function readCodingDrafts(): CodingDrafts | null {
	let raw: string;
	try { raw = fs.readFileSync(file, "utf8"); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
	return parseCodingDrafts(JSON.parse(raw));
}

export function writeCodingDrafts(value: unknown): CodingDrafts | null {
	const next = parseCodingDrafts(value);
	const current = readCodingDrafts();
	if (next.revision !== (current?.revision ?? 0)) return null;
	const saved = { ...next, revision: next.revision + 1 };
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 });
		fs.renameSync(temporary, file);
	} finally { try { fs.unlinkSync(temporary); } catch { /* already renamed */ } }
	return saved;
}
