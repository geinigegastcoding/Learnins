import assert from "node:assert/strict";
import { mkdtemp, mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { assertNoActiveMcpServers, buildDisabledMcpOverride, discoverCodexExecutable } from "../src/agent/codex-process.ts";

describe("Codex process isolation", () => {
	it("discovers the native npm binary and never selects a script wrapper", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "codex-discovery-"));
		const target = `${process.platform}-${process.arch}`;
		const triple = ({ "win32-x64": "x86_64-pc-windows-msvc", "win32-arm64": "aarch64-pc-windows-msvc", "linux-x64": "x86_64-unknown-linux-musl", "linux-arm64": "aarch64-unknown-linux-musl", "darwin-x64": "x86_64-apple-darwin", "darwin-arm64": "aarch64-apple-darwin" } as Record<string, string>)[target];
		assert.ok(triple);
		const binary = path.join(root, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", `codex-${target}`, "vendor", triple, "bin", process.platform === "win32" ? "codex.exe" : "codex");
		try {
			await mkdir(path.dirname(binary), { recursive: true });
			const signature = process.platform === "win32" ? Buffer.from([0x4d, 0x5a, 0, 0]) : process.platform === "linux" ? Buffer.from([0x7f, 0x45, 0x4c, 0x46]) : Buffer.from([0xfe, 0xed, 0xfa, 0xcf]);
			await writeFile(binary, signature);
			assert.deepEqual(await discoverCodexExecutable({ APPDATA: root, PATH: "" }), { executable: binary, args: [] });
			await writeFile(binary, "#!/usr/bin/env node\n");
			await assert.rejects(discoverCodexExecutable({ PATH: "" }), /not installed/);
			await assert.rejects(discoverCodexExecutable({ APPDATA: root, PATH: "" }), /not installed/);
		} finally {
			await unlink(binary).catch(() => undefined);
			for (let dir = path.dirname(binary); dir !== root; dir = path.dirname(dir)) await rmdir(dir);
			await rmdir(root);
		}
	});

	it("disables URL and command MCP transports with credential-free placeholders", () => {
		const override = buildDisabledMcpOverride({
			remote: { url: "https://private.example", bearer_token_env_var: "TOKEN", enabled: true },
			local: { command: "secret-command", args: ["secret-arg"], env: { TOKEN: "secret" } },
		});
		assert.match(override, /"remote"=\{enabled=false,url="http:\/\/127\.0\.0\.1:1"\}/);
		assert.match(override, /"local"=\{enabled=false,command="learnins-disabled"\}/);
		assert.doesNotMatch(override, /private|TOKEN|secret/);
	});

	it("rejects any server not explicitly disabled in effective config", () => {
		assertNoActiveMcpServers({ mcp_servers: { one: { enabled: false } } });
		assertNoActiveMcpServers({});
		assert.throws(() => assertNoActiveMcpServers({ mcp_servers: { one: { enabled: true } } }), /remains active/);
		assert.throws(() => assertNoActiveMcpServers({ mcp_servers: { one: {} } }), /remains active/);
	});
});
