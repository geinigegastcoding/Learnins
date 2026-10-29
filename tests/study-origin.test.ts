import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const tempRoot = fs.realpathSync(os.tmpdir());
const dataDir = fs.mkdtempSync(path.join(tempRoot, "learnins-origin-"));
process.env.LH_DATA_DIR = dataDir;
process.env.LH_AUTH_FILE = path.join(dataDir, "auth.json");

const materials = await import("../app/api/study/materials/route.ts");
const study = await import("../app/api/study/route.ts");
const transpile = await import("../app/api/study/transpile/route.ts");
const graphImport = await import("../app/api/graph/import/route.ts");

after(() => {
	const target = fs.realpathSync(dataDir);
	const relative = path.relative(tempRoot, target);
	if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("Unexpected test directory");
	fs.rmSync(target, { recursive: true, force: true });
});

function request(pathname: string, method: string, body: BodyInit, headers: Record<string, string> = {}) {
	return new Request(`http://127.0.0.1:3210${pathname}`, { method, body, headers });
}
function upload() {
	const form = new FormData();
	form.append("file", new File(["Cells are the basic units of life."], "lesson.txt", { type: "text/plain" }));
	form.append("revision", "0");
	return form;
}

describe("study request origins", () => {
	it("rejects cross-site forms and JSON mutations before changing local data", async () => {
		const crossSite = { origin: "https://outside.example", "sec-fetch-site": "cross-site" };
		assert.equal((await materials.POST(request("/api/study/materials", "POST", upload(), crossSite))).status, 403);
		assert.equal((await graphImport.POST(request("/api/graph/import", "POST", upload(), crossSite))).status, 403);
		assert.equal((await study.PUT(request("/api/study", "PUT", "{}", { ...crossSite, "content-type": "application/json" }))).status, 403);
		assert.equal((await transpile.POST(request("/api/study/transpile", "POST", '{"code":"const x: number = 1"}', { origin: "http://127.0.0.1:3210", "content-type": "text/plain" }))).status, 403);
		assert.equal((await materials.POST(request("/api/study/materials", "POST", upload(), { "sec-fetch-site": "cross-site" }))).status, 403);
		assert.deepEqual((await (await study.GET()).json()).materials, []);
	});

	it("allows an actual same-origin material upload and TypeScript conversion", async () => {
		const origin = "http://127.0.0.1:3210";
		const uploaded = await materials.POST(request("/api/study/materials", "POST", upload(), { origin, "sec-fetch-site": "same-origin" }));
		assert.equal(uploaded.status, 200);
		const saved = await uploaded.json();
		assert.equal(saved.materials[0].text, "Cells are the basic units of life.");
		const update = await study.PUT(request("/api/study", "PUT", JSON.stringify({ version: 1, revision: saved.revision, decks: [], exams: [] }), { origin, "content-type": "application/json" }));
		assert.equal(update.status, 200);
		assert.equal((await update.json()).materials[0].text, "Cells are the basic units of life.");
		const converted = await transpile.POST(request("/api/study/transpile", "POST", '{"code":"const x: number = 1"}', { origin, "content-type": "application/json" }));
		assert.equal(converted.status, 200);
		assert.match((await converted.json()).code, /const x\s*=\s*1/);
	});

	it("converts TypeScript features that need transformation and reports syntax errors", async () => {
		const headers = { origin: "http://127.0.0.1:3210", "content-type": "application/json" };
		const converted = await transpile.POST(request("/api/study/transpile", "POST", JSON.stringify({ code: "enum Grade { Pass = 3 }; globalThis.result = Grade.Pass" }), headers));
		assert.equal(converted.status, 200);
		const { code } = await converted.json();
		const context: { result?: number } = {};
		new Function("globalThis", code)(context);
		assert.equal(context.result, 3);
		const invalid = await transpile.POST(request("/api/study/transpile", "POST", JSON.stringify({ code: "const value: = ;" }), headers));
		assert.equal(invalid.status, 400);
	});
});
