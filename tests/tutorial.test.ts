import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { sanitizeUserSettings } from "../src/core/settings.ts";

const testData = mkdtempSync(path.join(tmpdir(), "learnins-tutorial-"));
process.env.LH_DATA_DIR = testData;
after(() => rmSync(testData, { recursive: true, force: true }));

it("persists dismissal without changing settings and rejects cross-origin writes", async () => {
	const { readSettings, writeSettings } = await import("../src/store/settings.ts");
	const { POST } = await import("../app/api/tutorial/route.ts");
	const settings = { version: 1, general: { autoUpdate: false }, appearance: { background: "#222222" } };
	writeSettings(settings);
	const rejected = await POST(new Request("http://localhost/api/tutorial", { method: "POST", headers: { origin: "https://other.example" } }));
	assert.equal(rejected.status, 403);
	assert.deepEqual(readSettings(), settings);
	const saved = await POST(new Request("http://localhost/api/tutorial", { method: "POST" }));
	assert.equal(saved.status, 200);
	assert.deepEqual(readSettings(), { ...settings, tutorialCompleted: true });
	const { PUT } = await import("../app/api/settings/[section]/route.ts");
	const update = await PUT(new Request("http://localhost/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ autoUpdate: true }) }), { params: Promise.resolve({ section: "general" }) });
	assert.equal(update.status, 200);
	assert.deepEqual(readSettings(), { ...settings, general: { autoUpdate: true }, tutorialCompleted: true });
	assert.equal(sanitizeUserSettings({ tutorialCompleted: "yes" })?.tutorialCompleted, undefined);
});
