import type { Api, AssistantMessage, JsonObject, Model, SimpleStreamOptions, StreamFunction, ToolCall, ToolResultMessage, TranscriptContext } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { launchIsolatedCodex, readCodexAccount, type IsolatedCodex } from "./codex-process.ts";
import { codexAbortController, codexBackgroundAllowed, codexScope, codexScopeCurrent } from "./codex-bridge.ts";
import { markUnadmittedUsage, type AdmissionScope, type SubscriptionDispatchLifecycle } from "./subscription-request-cycle.ts";

type ToolRequest = { kind: "tool"; requestId: string | number; callId: string; name: string; args: JsonObject };
type Packet = ToolRequest | { kind: "text"; itemId: string; delta: string } | { kind: "completed"; ok: boolean } | { kind: "error" };
type PendingSession = { session: CodexSession; call: ToolRequest; prefix: string; timer: ReturnType<typeof setTimeout> };
type TokenTally = { inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number; outputTokens: number; reasoningOutputTokens: number; totalTokens: number };
const pending = new Map<string, PendingSession>();
const IDLE_MS = 120_000;
const TURN_TIMEOUT_MS = 300_000;

function blank(model: Model<Api>): AssistantMessage {
	return { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], stopReason: "pending", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

class CodexSession {
	private queue: Packet[] = [];
	private waiter?: (packet: Packet) => void;
	private closed = false;
	private usage = { inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
	private reportedUsage = { ...this.usage };
	private stopMessage: () => void;
	private stopClose: () => void;
	constructor(readonly instance: IsolatedCodex, readonly threadId: string, readonly modelId: string, private readonly release: () => void) {
		this.stopMessage = instance.rpc.onMessage((raw) => {
			const p = raw.params as { threadId?: unknown; itemId?: unknown; delta?: unknown; turn?: { status?: unknown }; tool?: unknown; callId?: unknown; arguments?: unknown; namespace?: unknown; tokenUsage?: { total?: Partial<TokenTally> } } | undefined;
			if (p?.threadId !== threadId) return;
			if (raw.method === "thread/tokenUsage/updated" && p.tokenUsage?.total) {
				for (const key of Object.keys(this.usage) as (keyof TokenTally)[]) { const value = p.tokenUsage.total[key]; if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) this.usage[key] = value; }
			} else if (raw.method === "item/agentMessage/delta" && typeof p.itemId === "string" && typeof p.delta === "string") this.put({ kind: "text", itemId: p.itemId, delta: p.delta });
			else if (raw.method === "item/tool/call" && (typeof raw.id === "string" || typeof raw.id === "number")) {
				if (typeof p.callId !== "string" || typeof p.tool !== "string" || !p.arguments || typeof p.arguments !== "object" || Array.isArray(p.arguments) || (p.namespace !== null && p.namespace !== undefined)) {
					instance.rpc.replyError(raw.id, "Unsupported learning tool request."); this.put({ kind: "error" });
				} else this.put({ kind: "tool", requestId: raw.id, callId: p.callId, name: p.tool, args: p.arguments as JsonObject });
			} else if (raw.method === "turn/completed") this.put({ kind: "completed", ok: p.turn?.status === "completed" });
			else if (raw.id !== undefined && raw.method && (typeof raw.id === "string" || typeof raw.id === "number")) instance.rpc.replyError(raw.id, "Unsupported request.");
		});
		this.stopClose = instance.rpc.onClose(() => { if (!this.closed) { this.put({ kind: "error" }); queueMicrotask(() => this.dispose()); } });
	}
	takeUsage(): AssistantMessage["usage"] {
		const values = Object.fromEntries((Object.keys(this.usage) as (keyof TokenTally)[]).map((key) => [key, Math.max(0, this.usage[key] - this.reportedUsage[key])])) as TokenTally;
		this.reportedUsage = { ...this.usage };
		return { input: Math.max(0, values.inputTokens - values.cachedInputTokens - values.cacheWriteInputTokens), output: values.outputTokens, cacheRead: values.cachedInputTokens, cacheWrite: values.cacheWriteInputTokens, reasoning: values.reasoningOutputTokens, totalTokens: values.totalTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	}
	private put(packet: Packet) {
		if (this.closed) return;
		if (this.waiter) { const waiter = this.waiter; this.waiter = undefined; waiter(packet); }
		else if (this.queue.length < 4096) this.queue.push(packet);
		else { this.queue = [{ kind: "error" }]; }
	}
	next(signal?: AbortSignal): Promise<Packet> {
		if (signal?.aborted || this.closed) return Promise.reject(new Error("cancelled"));
		const packet = this.queue.shift();
		if (packet) return Promise.resolve(packet);
		return new Promise((resolve, reject) => {
			const finish = (value?: Packet) => {
				clearTimeout(timer); signal?.removeEventListener("abort", abort); this.waiter = undefined;
				if (value) resolve(value); else reject(new Error("cancelled or timed out"));
			};
			const abort = () => finish();
			const timer = setTimeout(abort, TURN_TIMEOUT_MS);
			this.waiter = finish;
			signal?.addEventListener("abort", abort, { once: true });
		});
	}
	dispose(): void {
		if (this.closed) return;
		this.closed = true;
		for (const [id, entry] of pending) if (entry.session === this) { clearTimeout(entry.timer); pending.delete(id); }
		this.waiter?.({ kind: "error" }); this.waiter = undefined;
		this.stopMessage(); this.stopClose();
		this.release();
		void this.instance.cleanup().catch(() => undefined);
	}
}

function replyContent(result: ToolResultMessage) {
	return result.content.map((part) => part.type === "text" ? { type: "inputText", text: part.text } : { type: "inputImage", imageUrl: `data:${part.mimeType};base64,${part.data}` });
}

/** Resume only the immediately preceding tool call with an unchanged transcript prefix. */
async function resume(context: TranscriptContext, model: Model<Api>, scope: AdmissionScope, admit: () => void): Promise<CodexSession | undefined> {
	const last = context.messages.at(-1), assistant = context.messages.at(-2);
	if (!last || last.role !== "toolResult" || !assistant || assistant.role !== "assistant") return undefined;
	const entry = pending.get(last.toolCallId);
	if (!entry) return undefined;
	clearTimeout(entry.timer); pending.delete(last.toolCallId);
	if (entry.session.modelId !== model.id || !assistant.content.some((c) => c.type === "toolCall" && c.id === last.toolCallId) || entry.prefix !== JSON.stringify(context.messages.slice(0, -2))) {
		entry.session.dispose(); return undefined;
	}
	try {
		if ((await readCodexAccount(entry.session.instance.rpc)).accountFingerprint !== scope.accountId) throw new Error("account changed");
		admit(); entry.session.instance.rpc.replyResult(entry.call.requestId, { success: !last.isError, contentItems: replyContent(last) });
	}
	catch (error) { entry.session.dispose(); throw error; }
	return entry.session;
}

async function start(model: Model<Api>, context: TranscriptContext, scope: AdmissionScope, admit: () => void, release: () => void, options?: SimpleStreamOptions): Promise<CodexSession> {
	const instance = await launchIsolatedCodex({ signal: options?.signal, timeoutMs: 20_000 });
	try {
		if (instance.status.accountFingerprint !== scope.accountId) throw new Error("account changed");
		const tools = getCurrentTools(context.messages);
		const started = await instance.rpc.request("thread/start", {
			model: model.id, cwd: instance.cwd, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", environments: [],
			baseInstructions: `${getCurrentSystemPrompt(context.messages)}\n\nUse only the learning tools provided for this session.`,
			dynamicTools: tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, inputSchema: tool.parameters })),
		}) as { thread?: { id?: unknown } };
		if (typeof started.thread?.id !== "string") throw new Error("missing thread");
		const threadId = started.thread.id;
		const items = convertResponsesMessages(model, context, new Set([model.provider]), { includeSystemPrompt: false }).map((item) => "role" in item && !("type" in item) ? { ...item, type: "message" } : item);
		if (items.length) await instance.rpc.request("thread/inject_items", { threadId, items });
		const session = new CodexSession(instance, threadId, model.id, release);
		try {
			admit();
			await instance.rpc.request("turn/start", { threadId, input: [], model: model.id, ...(options?.reasoning ? { effort: options.reasoning } : {}) });
			return session;
		} catch (error) { session.dispose(); throw error; }
	} catch (error) { await instance.cleanup(); throw error; }
}

/** Bridge Codex dynamic calls into Pi's existing learning-tool loop. */
export function codexStream(background: () => boolean = () => false, lifecycle?: SubscriptionDispatchLifecycle): StreamFunction<Api, SimpleStreamOptions> {
	return (model, context, options) => {
		const output = new AssistantMessageEventStream();
		void (async () => {
			const message = blank(model);
			let session: CodexSession | undefined, held = false;
			let scope: AdmissionScope | undefined, admitted = false, controllerOwned = false;
			const purpose = background(), { controller, release } = codexAbortController(purpose);
			const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
			const admit = () => {
				if (signal.aborted || !scope || !codexScopeCurrent(scope) || (purpose && !codexBackgroundAllowed())) throw new Error("admission changed");
				lifecycle?.beforeDispatch(scope); admitted = true;
			};
			const openText = new Map<string, number>();
			const endText = () => { for (const index of openText.values()) { const block = message.content[index]; if (block?.type === "text") output.push({ type: "text_end", contentIndex: index, content: block.text, partial: message }); } openText.clear(); };
			try {
				if (model.provider !== "codex-cli") throw new Error("wrong provider");
				if (signal.aborted) throw new Error("cancelled");
				scope = codexScope(model.id); lifecycle?.captured(scope);
				if (purpose && !codexBackgroundAllowed()) throw new Error("background disabled");
				session = await resume(context, model, scope, admit);
				if (!session) { session = await start(model, context, scope, admit, release, { ...options, signal }); controllerOwned = true; }
				output.push({ type: "start", partial: message });
				for (;;) {
					const packet = await session.next(signal);
					if (packet.kind === "error") throw new Error("connection failed");
					if (packet.kind === "text") {
						let index = openText.get(packet.itemId);
						if (index === undefined) { index = message.content.length; message.content.push({ type: "text", text: "" }); openText.set(packet.itemId, index); output.push({ type: "text_start", contentIndex: index, partial: message }); }
						const block = message.content[index]; if (block?.type === "text") block.text += packet.delta;
						output.push({ type: "text_delta", contentIndex: index, delta: packet.delta, partial: message });
					} else if (packet.kind === "tool") {
						if (!getCurrentTools(context.messages).some((tool) => tool.name === packet.name) || pending.has(packet.callId)) throw new Error("unsupported tool");
						endText();
						const call: ToolCall = { type: "toolCall", id: packet.callId, name: packet.name, arguments: packet.args };
						const index = message.content.length; message.content.push(call);
						output.push({ type: "toolcall_start", contentIndex: index, partial: message });
						output.push({ type: "toolcall_delta", contentIndex: index, delta: JSON.stringify(packet.args), partial: message });
						output.push({ type: "toolcall_end", contentIndex: index, toolCall: call, partial: message });
						const owned = session;
						const timer = setTimeout(() => owned.dispose(), IDLE_MS); timer.unref?.();
						pending.set(packet.callId, { session, call: packet, prefix: JSON.stringify(context.messages), timer });
						held = true; message.stopReason = "toolUse"; message.usage = session.takeUsage();
						output.push({ type: "done", reason: "toolUse", message }); return;
					} else {
						if (!packet.ok) throw new Error("incomplete response");
						endText(); message.stopReason = "stop"; message.usage = session.takeUsage();
						output.push({ type: "done", reason: "stop", message }); return;
					}
				}
			} catch {
				if (!admitted) { markUnadmittedUsage(message.usage); lifecycle?.noDispatch(options?.signal?.aborted || controller.signal.reason === "all" ? "all" : purpose && !codexBackgroundAllowed() && scope && codexScopeCurrent(scope) ? "background" : "other"); }
				message.stopReason = signal.aborted ? "aborted" : "error";
				message.errorMessage = message.stopReason === "aborted" ? "Codex request cancelled." : purpose && !codexBackgroundAllowed() ? "Background use is off for local Codex. Enable it in Providers to run this work." : "Codex could not complete this request. Check the local connection and try again.";
				output.push({ type: "error", reason: message.stopReason, error: message });
			} finally { if (!held) session?.dispose(); if (!controllerOwned) release(); output.end(); }
		})();
		return output;
	};
}
