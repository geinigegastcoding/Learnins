import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { CodexRpc } from "../src/agent/codex-rpc.ts";

async function fakeProcess(source: string, options: { requestTimeoutMs?: number; signal?: AbortSignal } = {}) {
	const directory = await mkdtemp(path.join(tmpdir(), "learnins-rpc-"));
	const script = path.join(directory, "fake.mjs");
	await writeFile(script, source, "utf8");
	const rpc = new CodexRpc({ executable: process.execPath, args: [script], cwd: directory, requestTimeoutMs: options.requestTimeoutMs, signal: options.signal });
	return {
		rpc,
		async cleanup() {
			rpc.close();
			await unlink(script).catch(() => undefined);
			await rmdir(directory).catch(() => undefined);
		},
	};
}

describe("CodexRpc", () => {
	it("handles split and multiple lines, out-of-order replies, and server messages", async () => {
		const child = await fakeProcess(`
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
 const m = JSON.parse(line);
 if (m.method === 'first') setTimeout(() => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:'one'})+'\\n'), 30);
 if (m.method === 'second') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:'two'})+'\\n');
 if (m.method === 'ping') process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'serverNotice',params:{ok:true}})+'\\n'+JSON.stringify({jsonrpc:'2.0',id:'server-1',method:'serverCall'})+'\\n'+JSON.stringify({jsonrpc:'2.0',id:m.id,result:true})+'\\n');
});
`);
		try {
			const incoming: Record<string, unknown>[] = [];
			child.rpc.onMessage((message) => { incoming.push(message); if (message.method === "serverCall") child.rpc.replyError("server-1", "unsupported"); });
			const first = child.rpc.request("first");
			const second = child.rpc.request("second");
			assert.deepEqual(await Promise.all([first, second]), ["one", "two"]);
			child.rpc.notify("clientNotice", { value: 1 });
			await child.rpc.request("ping");
			await new Promise((resolve) => setTimeout(resolve, 20));
			assert.deepEqual(incoming.map((message) => message.method), ["serverNotice", "serverCall"]);
		} finally { await child.cleanup(); }
	});

	it("rejects timed out requests", async () => {
		const child = await fakeProcess("process.stdin.resume();", { requestTimeoutMs: 25 });
		try { await assert.rejects(child.rpc.request("never"), /timed out/); }
		finally { await child.cleanup(); }
	});

	it("keeps large requests pending when the pipe applies backpressure", async () => {
		const child = await fakeProcess(`
import readline from 'node:readline';
readline.createInterface({input:process.stdin}).on('line', line => {
 const m = JSON.parse(line); process.stdout.write(JSON.stringify({id:m.id,result:m.params.text.length})+'\\n');
});
`);
		try { assert.equal(await child.rpc.request("large", { text: "x".repeat(100_000) }), 100_000); }
		finally { await child.cleanup(); }
	});

	it("fails closed when the subprocess sends malformed JSON", async () => {
		const child = await fakeProcess("process.stdin.resume(); process.stdin.once('data', () => process.stdout.write('not-json\\n'));");
		try { await assert.rejects(child.rpc.request("bad"), /invalid data/); }
		finally { await child.cleanup(); }
	});

	it("rejects outstanding requests on process exit", async () => {
		const child = await fakeProcess("process.stdin.resume(); setTimeout(() => process.exit(0), 25);");
		try { await assert.rejects(child.rpc.request("never"), /exited/); }
		finally { await child.cleanup(); }
	});

	it("rejects outstanding requests on abort", async () => {
		const controller = new AbortController();
		const child = await fakeProcess("process.stdin.resume();", { signal: controller.signal });
		try {
			const pending = child.rpc.request("never");
			controller.abort();
			await assert.rejects(pending, /aborted/);
		} finally { await child.cleanup(); }
	});
});
