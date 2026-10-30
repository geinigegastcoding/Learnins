import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { calendarFile, googleCalendarUrl, planExam, reviewCard, type StudyCard } from "../src/core/study.ts";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "learnins-study-test-"));
process.env.LH_DATA_DIR = dataDir;
test.after(() => {
	const file = path.join(dataDir, "study.json");
	if (fs.existsSync(file)) fs.unlinkSync(file);
	const materials = path.join(dataDir, "materials");
	if (fs.existsSync(materials)) fs.rmdirSync(materials);
	fs.rmdirSync(dataDir);
});

test("flashcards become due at the chosen interval and successful reviews grow", () => {
	const now = new Date("2026-10-28T10:00:00Z");
	const card: StudyCard = { id: "1", front: "hello", back: "hallo", dueAt: now.toISOString(), intervalMinutes: 0 };
	const good = reviewCard(card, "good", now);
	assert.equal(good.dueAt, "2026-10-29T10:00:00.000Z");
	assert.equal(reviewCard(good, "good", now).intervalMinutes, 2880);
	assert.equal(reviewCard(good, "again", now).dueAt, "2026-10-28T10:01:00.000Z");
});

test("planner respects available days and avoids existing blocks", () => {
	const occupied = { id: "busy", title: "Other subject", start: new Date(2026, 10, 11, 18).toISOString(), end: new Date(2026, 10, 11, 19).toISOString() };
	const exam = planExam({ subject: "Biology", date: "2026-11-14", topics: ["Cells", "Genetics"], minutes: 60, startTime: "18:00", weekdays: [1, 2, 3, 4, 5], occupied: [occupied], now: new Date(2026, 10, 10, 10) });
	assert.ok(exam.events.length > 0);
	assert.ok(exam.events.every((event) => ![0, 6].includes(new Date(event.start).getDay())));
	assert.ok(exam.events.every((event) => !(Date.parse(event.start) < Date.parse(occupied.end) && Date.parse(event.end) > Date.parse(occupied.start))));
	assert.throws(() => planExam({ subject: "Biology", date: "2026-02-30", topics: ["Cells"], minutes: 60, startTime: "18:00", now: new Date(2026, 0, 1) }));
	assert.throws(() => planExam({ subject: "Biology", date: "2026-11-14", topics: ["Cells"], minutes: 120, startTime: "23:00", now: new Date(2026, 10, 10) }));
	const compressed = planExam({ subject: "Biology", date: "2026-11-12", topics: ["Cells", "Genetics", "Ecology", "Evolution", "Plants"], minutes: 60, startTime: "18:00", now: new Date(2026, 10, 10, 10) });
	assert.equal(compressed.events.length, 2);
	for (const topic of compressed.topics) assert.ok(compressed.events.some((event) => event.title.includes(topic)), `${topic} is scheduled`);
});

test("a second exam fits around existing blocks within the learner's time window", () => {
	const busy = [
		{ id: "two", title: "Chemistry", start: new Date(2026, 10, 10, 19, 30).toISOString(), end: new Date(2026, 10, 10, 20).toISOString() },
		{ id: "one", title: "Biology", start: new Date(2026, 10, 10, 18).toISOString(), end: new Date(2026, 10, 10, 19).toISOString() },
	];
	const options = { subject: "History", date: "2026-11-12", topics: ["Dates"], minutes: 60, startTime: "18:00", latestEndTime: "21:00", now: new Date(2026, 10, 10, 17) };
	const plan = planExam({ ...options, occupied: busy });
	assert.equal(plan.events.length, 2);
	assert.equal(new Date(plan.events[0]!.start).getHours(), 20);
	assert.equal(new Date(plan.events[0]!.end).getHours(), 21);
	assert.equal(new Date(plan.events[1]!.start).getHours(), 18);
	assert.ok(plan.events.every((block) => busy.every((event) => !(Date.parse(block.start) < Date.parse(event.end) && Date.parse(block.end) > Date.parse(event.start)))));
	const tight = planExam({ ...options, latestEndTime: "19:30", occupied: busy });
	assert.equal(tight.events.length, 1);
	assert.equal(new Date(tight.events[0]!.start).getDate(), 11);
	const today = planExam({ ...options, now: new Date(2026, 10, 10, 18, 5) });
	assert.equal(new Date(today.events[0]!.start).getMinutes(), 15);
	assert.throws(() => planExam({ ...options, latestEndTime: "18:30" }), /window/);
});

test("calendar exports preserve UTC times and escape and fold long text", () => {
	const event = { id: "abc", title: "Biology, cells; " + "é".repeat(70), start: "2026-11-10T17:00:00.000Z", end: "2026-11-10T18:00:00.000Z" };
	const file = calendarFile([event]);
	assert.ok(file.includes("DTSTART:20261110T170000Z"));
	assert.ok(file.replace(/\r\n /g, "").includes("Biology\\, cells\\; "));
	assert.ok(file.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
	assert.equal(new URL(googleCalendarUrl(event)).searchParams.get("dates"), "20261110T170000Z/20261110T180000Z");
});

test("materials extract Teams transcripts, Word, slides and PDF text", async () => {
	const { extractStudyMaterial } = await import("../src/server/materials.ts");
	const docx = "UEsDBBQAAAAIAEK7XF3MDcfhaAAAAKEAAAARAAAAd29yZC9kb2N1bWVudC54bWyzKbdKyU8uzU3NK1GoyM3JK7Yqt1UqLcqzKkktLlGysym3SspPqQTRBSCiCESU2Dmn5uQUK6gl5hZYK6TmpRalV9rog8RBZBGYBKtG1hKcmpyfl6JQkFiUmF6UWJCBRYM+zDJ9hKPsAFBLAQIUABQAAAAIAEK7XF3MDcfhaAAAAKEAAAARAAAAAAAAAAAAAACAAQAAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAQABAD8AAACXAAAAAAA=";
	const pptx = "UEsDBBQAAAAIAEK7XF3A/MFwSAAAAGQAAAAVAAAAcHB0L3NsaWRlcy9zbGlkZTEueG1ssymwKs5JUajIzckrtiqwVSotyrMqSS0uUYIKJSIJ2dkkWhWAiCIQUWIXkJFfkl9cmVeSkVqcWWyjDxIDkUVgssDORh9suB0AUEsBAhQAFAAAAAgAQrtcXcD8wXBIAAAAZAAAABUAAAAAAAAAAAAAAIABAAAAAHBwdC9zbGlkZXMvc2xpZGUxLnhtbFBLBQYAAAAAAQABAEMAAAB7AAAAAAA=";
	assert.equal(await extractStudyMaterial(new File(["WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello class"], "meeting.vtt")), "Hello class");
	assert.equal(await extractStudyMaterial(new File([Buffer.from(docx, "base64")], "notes.docx")), "Cells & energy\nSecond paragraph");
	assert.match(await extractStudyMaterial(new File([Buffer.from(pptx, "base64")], "slides.pptx")), /Photosynthesis/);
	assert.ok((await extractStudyMaterial(new File([fs.readFileSync("tests/fixtures/sample-3page.pdf")], "lesson.pdf"))).length > 0);
	await assert.rejects(() => extractStudyMaterial(new File(["not an archive"], "bad.docx")));
});

test("free search returns result links and falls back to an encyclopedia when challenged", async () => {
	const { freeSearchProvider } = await import("../src/server/search.ts");
	const calls: string[] = [];
	const provider = freeSearchProvider(async (url) => {
		calls.push(url);
		return calls.length === 1 ? new Response("challenge", { status: 202 }) : Response.json({ query: { search: [{ title: "Cells", snippet: "A <b>cell</b> is alive." }] } });
	});
	const hits = await provider.search("cells", 2);
	assert.equal(calls.length, 2);
	assert.equal(hits[0]?.url, "https://en.wikipedia.org/wiki/Cells");
	assert.equal(hits[0]?.snippet, "A cell is alive.");
});

test("local study writes reject stale revisions and preserve corrupt files", async () => {
	const { readStudy, writeStudy } = await import("../src/server/study.ts");
	const { addStudyMaterial, deleteStudyMaterial, studyMaterialPaths } = await import("../src/server/materials.ts");
	fs.writeFileSync(path.join(dataDir, "study.json"), JSON.stringify({ version: 1, revision: 0, decks: [], exams: [], materials: [] }));
	const initial = readStudy();
	assert.deepEqual(initial.projects, []);
	const added = await addStudyMaterial(new File(["Original course notes"], "lesson.txt"), initial.revision);
	assert.equal(added?.revision, 1);
	const material = added!.materials[0]!;
	const paths = studyMaterialPaths(material.id)!;
	assert.equal(fs.readFileSync(paths.original, "utf8"), "Original course notes");
	assert.equal(fs.readFileSync(paths.extracted, "utf8"), "Original course notes");
	assert.equal(writeStudy(initial), null);
	assert.equal(await addStudyMaterial(new File(["Stale upload"], "stale.txt"), initial.revision), null);
	assert.equal(fs.readdirSync(path.join(dataDir, "materials")).length, 2);
	const withProject = writeStudy({ ...added!, projects: [{ id: "project", name: "Study", notes: "Details", materialIds: [material.id] }] });
	assert.equal(withProject?.revision, 2);
	assert.deepEqual(readStudy().projects[0]?.materialIds, [material.id]);
	assert.equal(writeStudy(added), null);
	const withoutProject = writeStudy({ ...withProject!, projects: [] });
	assert.equal(withoutProject?.revision, 3);
	assert.equal(fs.readFileSync(paths.original, "utf8"), "Original course notes");
	assert.equal(deleteStudyMaterial(material.id, 3)?.cleanupFailed, false);
	assert.equal(fs.readdirSync(path.join(dataDir, "materials")).length, 0);
	fs.writeFileSync(path.join(dataDir, "study.json"), "{broken");
	assert.throws(() => writeStudy(initial));
	assert.equal(fs.readFileSync(path.join(dataDir, "study.json"), "utf8"), "{broken");
});
