import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";
import { PATHS } from "../../config.ts";
import { launchIsolatedCodex } from "./codex-process.ts";
import type { AdmissionScope } from "./subscription-request-cycle.ts";

type Saved = { version: 1; enabled: boolean; allowBackgroundUse: boolean; accountFingerprint: string | null };
type State = { saved: Saved; valid: boolean; models: Model<Api>[]; error: string | null; revision: number; generation: number; mutation: number; checkedAt: number; refreshing?: Promise<void>; controllers: Map<AbortController, boolean>; listeners: Set<() => void> };
type CatalogEntry = { model?: unknown; displayName?: unknown; inputModalities?: unknown; supportedReasoningEfforts?: unknown };
const file = path.join(PATHS.data, "codex-connection.json");
const stateKey = Symbol.for("learnins.codex.connection");
const empty = (): Saved => ({ version: 1, enabled: false, allowBackgroundUse: true, accountFingerprint: null });

function readSaved(): { saved: Saved; valid: boolean } {
	try {
		const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Saved>;
		if (value.version !== 1 || typeof value.enabled !== "boolean" || typeof value.allowBackgroundUse !== "boolean" || !(value.accountFingerprint === null || typeof value.accountFingerprint === "string" && /^[0-9a-f]{64}$/.test(value.accountFingerprint)) || (value.enabled && !value.accountFingerprint)) throw new Error("invalid");
		return { saved: value as Saved, valid: true };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { saved: empty(), valid: true };
		return { saved: empty(), valid: false };
	}
}
function state(): State {
	const global = globalThis as typeof globalThis & { [stateKey]?: State };
	if (!global[stateKey]) {
		const saved = readSaved();
		global[stateKey] = { ...saved, models: [], error: saved.valid ? null : "Local Codex connection settings could not be read.", revision: 0, generation: 0, mutation: 0, checkedAt: 0, controllers: new Map(), listeners: new Set() };
	}
	global[stateKey].mutation ??= 0;
	return global[stateKey];
}
function persist(saved: Saved): void {
	if (!state().valid) throw new Error("Local Codex connection settings could not be read.");
	fs.mkdirSync(PATHS.data, { recursive: true });
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	try { fs.writeFileSync(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 }); fs.renameSync(temporary, file); }
	finally { try { fs.unlinkSync(temporary); } catch { /* already renamed */ } }
}
function notify(s: State) { for (const listener of s.listeners) listener(); }
function invalidate(s: State, reason: "all" | "background") {
	for (const [controller, background] of s.controllers) if (reason === "all" || background) controller.abort(reason);
	notify(s);
}

async function probe(supported: readonly Model<Api>[]) {
	const instance = await launchIsolatedCodex({ timeoutMs: 20_000 });
	try {
		const entries: CatalogEntry[] = [];
		let cursor: string | null = null;
		for (let page = 0; page < 10; page++) {
			const result = await instance.rpc.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }) as { data?: unknown; nextCursor?: unknown };
			if (!Array.isArray(result.data)) throw new Error("Codex model catalog unavailable.");
			entries.push(...result.data);
			if (result.nextCursor === null || result.nextCursor === undefined) break;
			if (typeof result.nextCursor !== "string" || !result.nextCursor || result.nextCursor === cursor || page === 9) throw new Error("Codex model catalog unavailable.");
			cursor = result.nextCursor;
		}
		const models: Model<Api>[] = entries.flatMap((entry) => {
			if (typeof entry.model !== "string" || !Array.isArray(entry.inputModalities) || !Array.isArray(entry.supportedReasoningEfforts)) return [];
			const known = supported.find((model) => model.id === entry.model && model.api === "openai-responses");
			if (!known) return [];
			const input = known.input.filter((modality) => (entry.inputModalities as unknown[]).includes(modality));
			if (!input.includes("text")) return [];
			const levels = new Set(entry.supportedReasoningEfforts.flatMap((level: unknown) => level && typeof level === "object" && typeof (level as { reasoningEffort?: unknown }).reasoningEffort === "string" ? [(level as { reasoningEffort: string }).reasoningEffort] : []));
			const thinkingLevelMap = { ...known.thinkingLevelMap };
			for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
				const mapped = thinkingLevelMap[level];
				const native = mapped ?? (level === "off" ? "none" : level);
				if (mapped === null || !levels.has(native)) thinkingLevelMap[level] = null;
			}
			return [{ ...known, provider: "codex-cli", name: typeof entry.displayName === "string" ? entry.displayName : known.name, input, thinkingLevelMap, headers: undefined, samplingParams: undefined, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }];
		});
		if (!models.length) throw new Error("No compatible Codex models are available.");
		return { models, accountFingerprint: instance.status.accountFingerprint };
	} finally { await instance.cleanup(); }
}

export function codexStatus() { const s = state(); return { enabled: s.saved.enabled, connected: s.saved.enabled && s.models.length > 0, allowBackgroundUse: s.saved.allowBackgroundUse, error: s.error }; }
export function codexConnected(): boolean { return codexStatus().connected; }
export function codexBackgroundAllowed(): boolean { return codexConnected() && state().saved.allowBackgroundUse; }
export function codexModels(): Model<Api>[] { return codexConnected() ? state().models : []; }
export function codexModel(id: string): Model<Api> | undefined { return codexModels().find((model) => model.id === id); }
export function onCodexChange(listener: () => void): () => void { const s = state(); s.listeners.add(listener); return () => { s.listeners.delete(listener); }; }

export async function connectCodex(supported: readonly Model<Api>[], allowBackgroundUse: boolean, getCatalog: typeof probe = probe): Promise<void> {
	const s = state(), mutation = ++s.mutation;
	const result = await getCatalog(supported);
	if (mutation !== s.mutation) throw new Error("Local Codex connection changed.");
	const saved: Saved = { version: 1, enabled: true, allowBackgroundUse, accountFingerprint: result.accountFingerprint };
	persist(saved); s.saved = saved; s.models = result.models; s.error = null; s.checkedAt = Date.now(); s.revision++; s.generation++;
	invalidate(s, "all");
}
export function disconnectCodex(): void {
	const s = state(), saved = { ...empty(), allowBackgroundUse: s.saved.allowBackgroundUse };
	persist(saved); s.saved = saved; s.models = []; s.error = null; s.checkedAt = 0; s.revision++; s.generation++; s.mutation++;
	invalidate(s, "all");
}
export function setCodexBackground(allowBackgroundUse: boolean): void {
	const s = state(), saved = { ...s.saved, allowBackgroundUse };
	persist(saved); s.saved = saved; s.mutation++;
	if (!allowBackgroundUse) invalidate(s, "background"); else notify(s);
}
export async function refreshCodexModels(supported: readonly Model<Api>[]): Promise<void> {
	const s = state();
	if (!s.saved.enabled || !s.valid || Date.now() - s.checkedAt < 30_000) return;
	if (s.refreshing) return s.refreshing;
	const generation = s.generation;
	s.refreshing = (async () => {
		try {
			const result = await probe(supported);
			if (generation !== s.generation) return;
			if (result.accountFingerprint !== s.saved.accountFingerprint) throw new Error("Codex is signed in to a different account. Reconnect to use it.");
			s.models = result.models; s.error = null; s.checkedAt = Date.now();
		} catch (error) {
			if (generation !== s.generation) return;
			s.models = []; s.error = error instanceof Error && /different account/.test(error.message) ? error.message : "Local Codex is unavailable. Check its sign-in and try again."; s.checkedAt = Date.now(); s.revision++;
			invalidate(s, "all");
		}
	})();
	try { await s.refreshing; } finally { s.refreshing = undefined; }
}
export function codexScope(modelId: string): AdmissionScope {
	const s = state();
	if (!codexModel(modelId) || !s.saved.accountFingerprint) throw new Error("Local Codex model catalog unavailable.");
	return { accountId: s.saved.accountFingerprint, epoch: s.generation, authorityRevision: s.revision, selectedModelId: modelId };
}
export function codexScopeCurrent(scope: AdmissionScope): boolean {
	try { return JSON.stringify(codexScope(scope.selectedModelId)) === JSON.stringify(scope); } catch { return false; }
}
export function codexAbortController(background: boolean) {
	const s = state(), controller = new AbortController(); s.controllers.set(controller, background);
	return { controller, release: () => { s.controllers.delete(controller); } };
}
