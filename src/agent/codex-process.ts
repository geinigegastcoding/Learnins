import { access, mkdtemp, open, rmdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { CodexRpc } from "./codex-rpc.ts";

const DISABLED_FEATURES = [
	"shell_tool", "unified_exec", "apps", "plugins", "hooks", "multi_agent",
	"browser_use", "browser_use_external", "browser_use_full_cdp_access", "computer_use",
	"image_generation", "in_app_browser", "in_app_local_automation", "view_image",
	"workspace_dependencies", "sleep_tool", "goals", "skill_search",
];
const DEFAULT_TIMEOUT_MS = 10_000;

export type CodexExecutable = { executable: string; args: string[] };
export type CodexStatus = { accountMode: "chatgpt"; accountFingerprint: string };
export type IsolatedCodex = { rpc: CodexRpc; cwd: string; status: CodexStatus; cleanup: () => Promise<void> };

/** Compare account identity without exposing or copying the CLI's credentials. */
export async function readCodexAccount(rpc: CodexRpc): Promise<CodexStatus> {
	const result = await rpc.request("account/read", { refreshToken: false }) as { account?: { type?: unknown; email?: unknown } };
	if (result?.account?.type !== "chatgpt") throw new Error("Codex must be signed in with a ChatGPT account.");
	if (typeof result.account.email !== "string" || !result.account.email.trim()) throw new Error("Codex account identity is unavailable.");
	return { accountMode: "chatgpt", accountFingerprint: createHash("sha256").update(result.account.email.trim().toLowerCase()).digest("hex") };
}

/** Find an installed native Codex entrypoint without invoking a shell or package manager. */
export async function discoverCodexExecutable(env: Partial<NodeJS.ProcessEnv> = process.env): Promise<CodexExecutable> {
	const candidates: CodexExecutable[] = [];
	const name = process.platform === "win32" ? "codex.exe" : "codex";
	const triples: Record<string, string> = { "win32-x64": "x86_64-pc-windows-msvc", "win32-arm64": "aarch64-pc-windows-msvc", "linux-x64": "x86_64-unknown-linux-musl", "linux-arm64": "aarch64-unknown-linux-musl", "darwin-x64": "x86_64-apple-darwin", "darwin-arm64": "aarch64-apple-darwin" };
	const target = `${process.platform}-${process.arch}`;
	const triple = triples[target];
	if (triple) {
		const roots = [env.APPDATA && path.join(env.APPDATA, "npm", "node_modules"), ...((env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.resolve(dir, "..", "lib", "node_modules")))].filter((root): root is string => Boolean(root));
		for (const root of roots) {
			for (const packageRoot of [path.join(root, "@openai", `codex-${target}`), path.join(root, "@openai", "codex", "node_modules", "@openai", `codex-${target}`), path.join(root, "@openai", "codex")]) {
				candidates.push({ executable: path.join(packageRoot, "vendor", triple, "bin", name), args: [] });
			}
		}
	}
	for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) candidates.push({ executable: path.join(dir, name), args: [] });
	if (env.USERPROFILE) candidates.push({ executable: path.join(env.USERPROFILE, ".cargo", "bin", name), args: [] });
	if (env.HOME) candidates.push({ executable: path.join(env.HOME, ".cargo", "bin", name), args: [] });
	for (const candidate of candidates) {
		try { if (await isNativeExecutable(candidate.executable)) return candidate; } catch { /* Try the next installed location. */ }
	}
	throw new Error("Codex CLI is not installed in a supported native location.");
}

/** Never spawn the npm script: on Windows killing its Node wrapper can orphan Codex. */
async function isNativeExecutable(file: string): Promise<boolean> {
	await access(file);
	const handle = await open(file, "r");
	try {
		const header = Buffer.alloc(4);
		const { bytesRead } = await handle.read(header, 0, 4, 0);
		if (bytesRead < 4) return false;
		if (process.platform === "win32") return header[0] === 0x4d && header[1] === 0x5a;
		if (process.platform === "linux") return header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
		return ["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca"].includes(header.toString("hex"));
	} finally { await handle.close(); }
}

/** Produce a single inline TOML override that disables every discovered MCP server. */
export function buildDisabledMcpOverride(servers: Record<string, unknown>): string {
	const entries = Object.entries(servers).map(([name, raw]) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Codex returned an unsupported MCP server configuration.");
		const server = raw as Record<string, unknown>;
		const transport = typeof server.url === "string" ? `url=${tomlString("http://127.0.0.1:1")}` : `command=${tomlString("learnins-disabled")}`;
		return `${tomlString(name)}={enabled=false,${transport}}`;
	});
	return `mcp_servers={${entries.join(",")}}`;
}

/** Fail closed unless the effective config explicitly disables every listed server. */
export function assertNoActiveMcpServers(config: unknown): void {
	if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Codex returned an invalid effective configuration.");
	const servers = (config as Record<string, unknown>).mcp_servers;
	if (servers === undefined) return;
	if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw new Error("Codex returned an invalid MCP server configuration.");
	for (const server of Object.values(servers as Record<string, unknown>)) {
		if (!server || typeof server !== "object" || Array.isArray(server) || (server as Record<string, unknown>).enabled !== false) {
			throw new Error("Codex MCP isolation failed: an MCP server remains active.");
		}
	}
}

export async function launchIsolatedCodex(options: { signal?: AbortSignal; timeoutMs?: number; executable?: CodexExecutable } = {}): Promise<IsolatedCodex> {
	const executable = options.executable ?? await discoverCodexExecutable();
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const env = { ...process.env };
	// A Learnins request must never attach to the Codex session that launched it.
	for (const name of Object.keys(env)) if ((name.startsWith("CODEX_") && name !== "CODEX_HOME") || name.startsWith("T3CODE_")) delete env[name];
	delete env.OPENAI_API_KEY;
	const launch = async (extraArgs: string[]) => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), "learnins-codex-"));
		const rpc = new CodexRpc({ executable: executable.executable, args: [...executable.args, "app-server", ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]), "-c", 'web_search="disabled"', ...extraArgs], cwd, env, signal: options.signal, requestTimeoutMs: timeoutMs });
		return { rpc, cwd };
	};
	const handshake = async (rpc: CodexRpc) => {
		await rpc.request("initialize", { clientInfo: { name: "learnins", version: "0.1" }, capabilities: { experimentalApi: true } });
		rpc.notify("initialized", {});
	};
	let preflight: Awaited<ReturnType<typeof launch>> | undefined;
	let live: Awaited<ReturnType<typeof launch>> | undefined;
	try {
		preflight = await launch([]);
		await handshake(preflight.rpc);
		const initial = await preflight.rpc.request("config/read", { includeLayers: false }) as { config?: { mcp_servers?: Record<string, unknown> } };
		const override = buildDisabledMcpOverride(initial?.config?.mcp_servers ?? {});
		preflight.rpc.close();
		await removeTemp(preflight.cwd);
		preflight = undefined;

		live = await launch(["-c", override]);
		await handshake(live.rpc);
		const effective = await live.rpc.request("config/read", { includeLayers: false }) as { config?: unknown };
		assertNoActiveMcpServers(effective?.config);
		const status = await readCodexAccount(live.rpc);
		const owned = live;
		let cleaned = false;
		return { rpc: owned.rpc, cwd: owned.cwd, status, async cleanup() {
			if (cleaned) return;
			cleaned = true;
			owned.rpc.close();
			await removeTemp(owned.cwd);
		} };
	} catch (error) {
		preflight?.rpc.close();
		live?.rpc.close();
		await Promise.all([preflight?.cwd, live?.cwd].filter((cwd): cwd is string => Boolean(cwd)).map(removeTemp));
		if (options.signal?.aborted) throw new Error("Codex startup was aborted.");
		if (error instanceof Error && /Codex CLI is not installed|Codex MCP isolation failed|ChatGPT account|account identity|unsupported MCP|invalid effective|invalid MCP/.test(error.message)) throw error;
		throw new Error("Codex app-server preflight failed or timed out.");
	}
}

function tomlString(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`;
}

async function removeTemp(directory: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try { await rmdir(directory); return; }
		catch (error) {
			if (error && typeof error === "object" && ["ENOENT", "ENOTEMPTY"].includes(String((error as NodeJS.ErrnoException).code))) return;
			if (attempt >= 20 || !error || typeof error !== "object" || !["EBUSY", "EPERM"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
}
