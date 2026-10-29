import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PATHS } from "../../config.ts";
import type { StudyEvent } from "../core/study.ts";

type CommandResult = { code: number; stdout: string; stderr: string };
export type GoogleCalendarRunner = (args: string[], signal?: AbortSignal) => Promise<CommandResult>;
export type CalendarStatus = { available: boolean; connected: boolean; pending: boolean; authUrl: string | null; message: string | null };
const MAX_OUTPUT = 1_000_000;
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const profile = path.join(PATHS.data, "google-calendar");
type LoginState = { child?: ChildProcess; authUrl: string | null; message: string | null; timer?: ReturnType<typeof setTimeout> };
const LOGIN_KEY = Symbol.for("learnins.google-calendar.login");
function loginState(): LoginState { const global = globalThis as typeof globalThis & { [LOGIN_KEY]?: LoginState }; return global[LOGIN_KEY] ??= { authUrl: null, message: null }; }

/** Give this app its own CLI profile; never overwrite the user's global Workspace login. */
export function googleWorkspaceEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env = { ...source };
	const originalConfig = source.GOOGLE_WORKSPACE_CLI_CONFIG_DIR || path.join(os.homedir(), ".config", "gws");
	if (!env.GOOGLE_WORKSPACE_CLI_CLIENT_ID || !env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET) {
		try {
			const raw = JSON.parse(fs.readFileSync(path.join(originalConfig, "client_secret.json"), "utf8")) as { installed?: { client_id?: unknown; client_secret?: unknown }; web?: { client_id?: unknown; client_secret?: unknown } };
			const client = raw.installed ?? raw.web;
			if (typeof client?.client_id === "string" && typeof client.client_secret === "string") {
				env.GOOGLE_WORKSPACE_CLI_CLIENT_ID = client.client_id; env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET = client.client_secret;
			}
		} catch { /* A missing client is reported when the user starts sign-in. */ }
	}
	delete env.GOOGLE_WORKSPACE_CLI_TOKEN; delete env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE; delete env.GOOGLE_APPLICATION_CREDENTIALS;
	env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = profile;
	env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND = "file";
	return env;
}

/** Find an existing native CLI; never run the npm wrapper that can auto-install. */
export function findGoogleWorkspaceCli(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const name = process.platform === "win32" ? "gws.exe" : "gws";
	const roots = [env.APPDATA && path.join(env.APPDATA, "npm", "node_modules"), ...(env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.resolve(dir, "..", "lib", "node_modules"))].filter((root): root is string => !!root);
	const candidates = [...roots.map((root) => path.join(root, "@googleworkspace", "cli", "bin", name)), ...(env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, name))];
	for (const file of candidates) {
		try {
			const fd = fs.openSync(file, "r");
			const signature = Buffer.alloc(4);
			try { if (fs.readSync(fd, signature, 0, 4, 0) !== 4) continue; } finally { fs.closeSync(fd); }
			if (process.platform === "win32" ? signature[0] === 0x4d && signature[1] === 0x5a : process.platform === "linux" ? signature.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) : ["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca"].includes(signature.toString("hex"))) return file;
		} catch { /* Try the next installed location. */ }
	}
	return undefined;
}

export const runGoogleWorkspace: GoogleCalendarRunner = (args, signal) => new Promise((resolve, reject) => {
	const executable = findGoogleWorkspaceCli();
	if (!executable) { reject(new Error("Google Workspace CLI is not installed.")); return; }
	if (signal?.aborted) { reject(new Error("Cancelled.")); return; }
	const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: googleWorkspaceEnvironment() });
	let stdout = "", stderr = "", settled = false;
	const finish = (result?: CommandResult) => {
		if (settled) return;
		settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
		if (result) resolve(result); else { child.kill(); reject(new Error("Google Workspace request failed or timed out.")); }
	};
	const abort = () => finish();
	const timer = setTimeout(abort, 30_000);
	signal?.addEventListener("abort", abort, { once: true });
	if (signal?.aborted) abort();
	child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); if (stdout.length > MAX_OUTPUT) finish(); });
	child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); if (stderr.length > MAX_OUTPUT) finish(); });
	child.on("error", () => finish());
	child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
});

/** Verify both sign-in and calendar scope without returning calendar contents. */
export async function googleCalendarStatus(run: GoogleCalendarRunner = runGoogleWorkspace): Promise<CalendarStatus> {
	const login = loginState();
	if (login.child) return { available: true, connected: false, pending: true, authUrl: login.authUrl, message: "Complete Google sign-in in your browser." };
	if (run === runGoogleWorkspace && !findGoogleWorkspaceCli()) return { available: false, connected: false, pending: false, authUrl: null, message: "Install Google Workspace CLI to connect directly." };
	if (run === runGoogleWorkspace && !fs.existsSync(path.join(profile, "credentials.enc"))) return { available: true, connected: false, pending: false, authUrl: null, message: login.message ?? "Connect Google Calendar to add a whole plan." };
	try {
		const auth = await run(["auth", "status"]);
		const value = JSON.parse(auth.stdout) as { token_valid?: unknown };
		if (auth.code !== 0 || value.token_valid !== true) return { available: true, connected: false, pending: false, authUrl: null, message: "Google sign-in expired. Connect again to continue." };
		const calendar = await run(["calendar", "events", "list", "--params", JSON.stringify({ calendarId: "primary", maxResults: 1, fields: "items(id)" })]);
		if (calendar.code !== 0) return { available: true, connected: false, pending: false, authUrl: null, message: "The signed-in account needs access to its Google Calendar." };
		return { available: true, connected: true, pending: false, authUrl: null, message: null };
	} catch {
		return { available: !!findGoogleWorkspaceCli(), connected: false, pending: false, authUrl: null, message: "Google Calendar could not be checked. Try again." };
	}
}

/** Only expose Google's own loopback OAuth URL, never CLI output or credentials. */
export function validGoogleAuthUrl(text: string, expectedClientId?: string): string | undefined {
	try {
		const url = new URL(text);
		const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
		const scopes = url.searchParams.get("scope")?.split(/\s+/) ?? [];
		const allowed = new Set([CALENDAR_SCOPE, "openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"]);
		if (url.protocol !== "https:" || url.host !== "accounts.google.com" || url.username || url.password || !url.pathname.startsWith("/o/oauth2/") || url.searchParams.get("response_type") !== "code" || (expectedClientId && url.searchParams.get("client_id") !== expectedClientId) || redirect.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(redirect.hostname) || !redirect.port || redirect.username || redirect.password || !scopes.includes(CALENDAR_SCOPE) || scopes.some((scope) => !allowed.has(scope))) return undefined;
		return url.toString();
	} catch { return undefined; }
}

export function startGoogleCalendarLogin(): void {
	const login = loginState();
	if (login.child) return;
	const executable = findGoogleWorkspaceCli();
	if (!executable) throw new Error("Install Google Workspace CLI to connect directly.");
	const env = googleWorkspaceEnvironment();
	if (!env.GOOGLE_WORKSPACE_CLI_CLIENT_ID || !env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET) throw new Error("Set up a Google Workspace CLI OAuth client before connecting.");
	fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
	login.message = null; login.authUrl = null;
	const child = spawn(executable, ["auth", "login", "--scopes", CALENDAR_SCOPE], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
	login.child = child;
	const receive = () => {
		let buffer = "";
		return (chunk: Buffer) => {
			if (login.child !== child) return;
			buffer = (buffer + chunk.toString("utf8")).slice(-64_000);
			const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
			for (const line of lines) { const candidate = line.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/\S+/)?.[0]; if (candidate) login.authUrl = validGoogleAuthUrl(candidate, env.GOOGLE_WORKSPACE_CLI_CLIENT_ID) ?? null; }
		};
	};
	child.stdout?.on("data", receive()); child.stderr?.on("data", receive());
	const close = (code: number | null) => {
		if (login.child !== child) return;
		if (login.timer) clearTimeout(login.timer);
		login.child = undefined; login.authUrl = null; login.message = code === 0 ? null : "Google sign-in did not complete. Try connecting again.";
	};
	child.on("error", () => close(1)); child.on("close", close);
	login.timer = setTimeout(() => { child.kill(); close(1); }, 300_000); login.timer.unref?.();
}

export function cancelGoogleCalendarLogin(): void {
	const login = loginState();
	if (login.timer) clearTimeout(login.timer);
	login.child?.kill(); login.child = undefined; login.authUrl = null; login.message = null;
}

/** Disconnect removes only this app's profile; it does not revoke the Google grant. */
export function disconnectGoogleCalendar(): void {
	cancelGoogleCalendarLogin();
	for (const name of ["credentials.enc", "credentials.json", "token_cache.json", ".encryption_key"]) {
		try { fs.unlinkSync(path.join(profile, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
}

/** Stable Google IDs make retries safe even if the response to an insert is lost. */
export function googleEventId(id: string): string { return `ln${createHash("sha256").update(id).digest("hex").slice(0, 32)}`; }
function parseResult(result: CommandResult): Record<string, unknown> | undefined {
	for (const text of [result.stdout, result.stderr]) try { const parsed: unknown = JSON.parse(text); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>; } catch { /* CLI diagnostics need not be JSON. */ }
	return undefined;
}

export async function addGoogleCalendarEvents(events: readonly StudyEvent[], run: GoogleCalendarRunner = runGoogleWorkspace, signal?: AbortSignal): Promise<{ added: number; alreadyAdded: number; failed: number }> {
	let added = 0, alreadyAdded = 0, failed = 0;
	for (const event of events) {
		if (signal?.aborted) { failed += events.length - added - alreadyAdded - failed; break; }
		const id = googleEventId(event.id);
		if (!event.title.trim() || event.title.length > 1024 || !Number.isFinite(Date.parse(event.start)) || !Number.isFinite(Date.parse(event.end)) || Date.parse(event.end) <= Date.parse(event.start)) { failed++; continue; }
		const body = { id, summary: event.title, description: "Study block planned in Learnins.", start: { dateTime: event.start }, end: { dateTime: event.end }, extendedProperties: { private: { learninsEventId: id } } };
		try {
			const inserted = await run(["calendar", "events", "insert", "--params", JSON.stringify({ calendarId: "primary", sendUpdates: "none" }), "--json", JSON.stringify(body)], signal);
			if (inserted.code === 0) { added++; continue; }
			const error = parseResult(inserted)?.error as { code?: unknown } | undefined;
			if (error?.code === 409 || /\b409\b/.test(inserted.stderr)) {
				const existing = await run(["calendar", "events", "get", "--params", JSON.stringify({ calendarId: "primary", eventId: id, fields: "id,extendedProperties" })], signal);
				const value = parseResult(existing) as { id?: unknown; extendedProperties?: { private?: { learninsEventId?: unknown } } } | undefined;
				if (existing.code === 0 && value?.id === id && value.extendedProperties?.private?.learninsEventId === id) { alreadyAdded++; continue; }
			}
			failed++;
		} catch { failed++; }
	}
	return { added, alreadyAdded, failed };
}
