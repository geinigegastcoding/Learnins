import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PATHS } from "../../config.ts";
import { emptyStudyData, type StudyData } from "../core/study.ts";

const id = z.string().min(1).max(120);
const text = z.string().min(1).max(100_000);
const instant = z.string().max(40).refine((value) => Number.isFinite(Date.parse(value)));
const event = z.object({ id, title: text, start: instant, end: instant, completed: z.boolean().optional() }).strict();
const card = z.object({
	id, front: text, back: text, dueAt: instant,
	intervalMinutes: z.number().int().min(0).max(10_000_000),
	sourceNodeId: id.optional(),
}).strict();
const schema = z.object({
	version: z.literal(1),
	revision: z.number().int().min(0),
	decks: z.array(z.object({ id, name: text, cards: z.array(card).max(5000) }).strict()).max(200),
	exams: z.array(z.object({
		id, subject: text, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		topics: z.array(text).max(200), events: z.array(event).max(500),
	}).strict()).max(200),
	materials: z.array(z.object({ id, name: text, text: z.string().max(1_000_000), createdAt: instant, originalExtension: z.string().regex(/^\.[a-z0-9]{1,10}$/).optional() }).strict()).max(200),
	projects: z.array(z.object({ id, name: text, notes: z.string().max(100_000), materialIds: z.array(id).max(200) }).strict()).max(200).default([]),
}).strict();

const studyFile = path.join(PATHS.data, "study.json");

/** A corrupt file is an error, not an empty database that can overwrite it. */
export function readStudy(): StudyData {
	let raw: string;
	try { raw = fs.readFileSync(studyFile, "utf8"); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStudyData();
		throw error;
	}
	return schema.parse(JSON.parse(raw));
}

export function writeStudy(value: unknown): StudyData | null {
	const next = schema.parse(value);
	const current = readStudy();
	if (next.revision !== current.revision) return null;
	const saved = { ...next, revision: current.revision + 1 };
	fs.mkdirSync(path.dirname(studyFile), { recursive: true });
	const temporary = `${studyFile}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 });
		fs.renameSync(temporary, studyFile);
	} finally {
		try { fs.unlinkSync(temporary); } catch { /* already renamed */ }
	}
	return saved;
}
