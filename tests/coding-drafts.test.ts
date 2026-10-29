import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "learnins-coding-drafts-"));
process.env.LH_DATA_DIR = dataDir;
const file = path.join(dataDir, "coding-drafts.json");

let drafts: typeof import("../src/server/coding-drafts.ts");

before(async () => {
	drafts = await import("../src/server/coding-drafts.ts");
});

after(() => {
	try { fs.unlinkSync(file); } catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	fs.rmdirSync(dataDir);
});

const payload = (revision: number) => ({
	version: 1,
	revision,
	drafts: { javascript: "const answer = 42;", typescript: "const answer: number = 42;", python: "answer = 42" },
	tests: { javascript: "", typescript: "", python: "" },
});

describe("coding drafts persistence", () => {
	it("returns null when the file is missing", () => {
		assert.equal(drafts.readCodingDrafts(), null);
	});

	it("saves a valid draft and reloads it with the next revision", () => {
		const saved = drafts.writeCodingDrafts(payload(0));
		assert.deepEqual(saved, { ...payload(0), revision: 1 });
		assert.deepEqual(drafts.readCodingDrafts(), saved);
	});

	it("refuses a stale revision", () => {
		assert.equal(drafts.writeCodingDrafts(payload(0)), null);
		assert.equal(drafts.readCodingDrafts()?.revision, 1);
	});

	it("does not overwrite a corrupt existing file", () => {
		const corrupt = "{not valid json";
		fs.writeFileSync(file, corrupt, "utf8");
		assert.throws(() => drafts.writeCodingDrafts(payload(0)));
		assert.equal(fs.readFileSync(file, "utf8"), corrupt);
	});

	it("rejects an invalid payload", () => {
		assert.throws(() => drafts.writeCodingDrafts({ ...payload(0), extra: true }));
	});
});
