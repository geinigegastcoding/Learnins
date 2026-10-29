import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addGoogleCalendarEvents, googleCalendarStatus, googleEventId, googleWorkspaceEnvironment, validGoogleAuthUrl, type GoogleCalendarRunner } from "../src/server/google-calendar.ts";
import { googleCalendarResponse } from "../src/server/calendar-response.ts";

const block = { id: "block-1", title: "Biology: cells", start: "2026-11-02T15:00:00.000Z", end: "2026-11-02T16:00:00.000Z" };
const ok = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });

describe("Google Calendar handoff", () => {
	it("isolates credentials and accepts only the intended Google consent URL", () => {
		const source = { NODE_ENV: "test" as const, GOOGLE_WORKSPACE_CLI_CLIENT_ID: "test-client", GOOGLE_WORKSPACE_CLI_CLIENT_SECRET: "test-secret", GOOGLE_WORKSPACE_CLI_TOKEN: "test-token", GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE: "elsewhere", GOOGLE_APPLICATION_CREDENTIALS: "elsewhere" };
		const env = googleWorkspaceEnvironment(source);
		assert.notEqual(env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR, source.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE);
		assert.equal(env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND, "file");
		assert.equal(env.GOOGLE_WORKSPACE_CLI_TOKEN, undefined);
		assert.equal(env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE, undefined);
		assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
		assert.equal(source.GOOGLE_WORKSPACE_CLI_TOKEN, "test-token");
		const url = new URL("https://accounts.google.com/o/oauth2/auth");
		url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events.owned openid");
		url.searchParams.set("redirect_uri", "http://localhost:12345");
		url.searchParams.set("response_type", "code"); url.searchParams.set("client_id", "test-client");
		assert.ok(validGoogleAuthUrl(url.toString(), "test-client"));
		assert.equal(validGoogleAuthUrl(url.toString(), "wrong-client"), undefined);
		url.searchParams.set("redirect_uri", "https://elsewhere.example");
		assert.equal(validGoogleAuthUrl(url.toString(), "test-client"), undefined);
		url.searchParams.set("redirect_uri", "http://localhost:12345");
		url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events.owned https://www.googleapis.com/auth/cloud-platform");
		assert.equal(validGoogleAuthUrl(url.toString(), "test-client"), undefined);
	});

	it("reports a connected account only after a scoped calendar read succeeds", async () => {
		const calls: string[][] = [];
		const run: GoogleCalendarRunner = async (args) => { calls.push(args); return args[0] === "auth" ? ok({ token_valid: true }) : ok({ items: [] }); };
		assert.equal((await googleCalendarStatus(run)).connected, true);
		assert.equal(calls[1]?.slice(0, 4).join(" "), "calendar events list --params");
		assert.equal((await googleCalendarStatus(async () => ok({ token_valid: false }))).connected, false);
	});

	it("adds study blocks without attendees or notification emails", async () => {
		let body: Record<string, unknown> | undefined, params: Record<string, unknown> | undefined;
		const run: GoogleCalendarRunner = async (args) => { body = JSON.parse(args[args.indexOf("--json") + 1]!); params = JSON.parse(args[args.indexOf("--params") + 1]!); return ok({ id: body?.id }); };
		assert.deepEqual(await addGoogleCalendarEvents([block], run), { added: 1, alreadyAdded: 0, failed: 0 });
		assert.equal(body?.id, googleEventId(block.id));
		assert.equal(body?.summary, block.title);
		assert.equal(body?.attendees, undefined);
		assert.equal(params?.sendUpdates, "none");
	});

	it("recognizes a prior successful insert after a lost response without duplicating it", async () => {
		const id = googleEventId(block.id);
		const failed: GoogleCalendarRunner = async () => { throw new Error("connection dropped"); };
		assert.equal((await addGoogleCalendarEvents([block], failed)).failed, 1);
		const retry: GoogleCalendarRunner = async (args) => args[2] === "insert" ? { code: 1, stdout: JSON.stringify({ error: { code: 409 } }), stderr: "" } : ok({ id, extendedProperties: { private: { learninsEventId: id } } });
		assert.deepEqual(await addGoogleCalendarEvents([block], retry), { added: 0, alreadyAdded: 1, failed: 0 });
		const collision: GoogleCalendarRunner = async (args) => args[2] === "insert" ? { code: 1, stdout: JSON.stringify({ error: { code: 409 } }), stderr: "" } : ok({ id });
		assert.equal((await addGoogleCalendarEvents([block], collision)).failed, 1);
	});

	it("rejects malformed study blocks and cross-origin write requests", async () => {
		let invoked = false;
		assert.equal((await addGoogleCalendarEvents([{ ...block, end: "invalid" }], async () => { invoked = true; return ok({}); })).failed, 1);
		assert.equal(invoked, false);
		const response = await googleCalendarResponse(new Request("http://localhost:3210/api/study/calendar", { method: "POST", headers: { host: "localhost:3210", origin: "https://elsewhere.example", "content-type": "application/json" }, body: JSON.stringify({ examId: "x" }) }));
		assert.equal(response.status, 403);
	});
});
