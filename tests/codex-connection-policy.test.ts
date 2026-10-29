import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codexConnectionResponse } from "../src/server/codex-connection.ts";

describe("local Codex connection endpoint", () => {
	it("rejects cross-origin and non-JSON changes before touching connection state", async () => {
		const body = JSON.stringify({ action: "disconnect" });
		const crossOrigin = await codexConnectionResponse(new Request("http://localhost:3210/api/codex", { method: "POST", headers: { host: "localhost:3210", origin: "http://other.example", "content-type": "application/json" }, body }));
		assert.equal(crossOrigin.status, 403);
		const formPost = await codexConnectionResponse(new Request("http://localhost:3210/api/codex", { method: "POST", headers: { host: "localhost:3210", origin: "http://localhost:3210", "content-type": "text/plain" }, body }));
		assert.equal(formPost.status, 403);
	});

	it("rejects unsupported actions", async () => {
		const response = await codexConnectionResponse(new Request("http://localhost:3210/api/codex", { method: "POST", headers: { host: "localhost:3210", origin: "http://localhost:3210", "content-type": "application/json" }, body: JSON.stringify({ action: "unknown" }) }));
		assert.equal(response.status, 400);
	});
});
