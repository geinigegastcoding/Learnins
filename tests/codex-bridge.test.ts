import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const directory = mkdtempSync(path.join(os.tmpdir(), "learnins-codex-test-"));
process.env.LH_DATA_DIR = directory;
const { piModels } = await import("../src/agent/models.ts");
const { codexAbortController, codexScope, codexScopeCurrent, codexStatus, connectCodex, disconnectCodex, setCodexBackground } = await import("../src/agent/codex-bridge.ts");
const base = piModels().getModel("openai", "gpt-6-luna");
assert.ok(base);
const model = { ...base, provider: "codex-cli" };
const catalog = async () => ({ models: [model], accountFingerprint: "a".repeat(64) });

after(() => { try { unlinkSync(path.join(directory, "codex-connection.json")); } catch { /* absent after an early failure */ } rmdirSync(directory); });

describe("local Codex consent", () => {
	it("stores consent, gates background use and cancels outstanding work on disconnect", async () => {
		await connectCodex([], true, catalog);
		assert.equal(codexStatus().connected, true);
		const scope = codexScope(model.id);
		const background = codexAbortController(true), foreground = codexAbortController(false);
		setCodexBackground(false);
		assert.equal(background.controller.signal.reason, "background");
		assert.equal(foreground.controller.signal.aborted, false);
		assert.equal(codexScopeCurrent(scope), true);
		assert.equal(codexStatus().allowBackgroundUse, false);
		disconnectCodex();
		assert.equal(foreground.controller.signal.reason, "all");
		assert.equal(codexScopeCurrent(scope), false);
		assert.equal(codexStatus().connected, false);
		assert.equal(JSON.parse(readFileSync(path.join(directory, "codex-connection.json"), "utf8")).enabled, false);
		background.release(); foreground.release();
	});

	it("does not let a delayed connection overwrite a newer preference", async () => {
		let finish!: (value: Awaited<ReturnType<typeof catalog>>) => void;
		const delayed = new Promise<Awaited<ReturnType<typeof catalog>>>((resolve) => { finish = resolve; });
		const connecting = connectCodex([], true, () => delayed);
		setCodexBackground(false);
		finish(await catalog());
		await assert.rejects(connecting, /connection changed/);
		assert.equal(codexStatus().enabled, false);
		assert.equal(codexStatus().allowBackgroundUse, false);
	});
});
