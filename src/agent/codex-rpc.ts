import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

const MAX_LINE_BYTES = 8 * 1024 * 1024;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };

/** Minimal newline-delimited JSON-RPC transport for a local subprocess. */
export class CodexRpc {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<string | number, Pending>();
	private readonly listeners = new Set<(message: Record<string, unknown>) => void>();
	private readonly closeListeners = new Set<(error: Error) => void>();
	private buffer = Buffer.alloc(0);
	private closed = false;
	private counter = 0;
	private readonly abortHandler: () => void;

	constructor(options: { executable: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; requestTimeoutMs?: number }) {
		this.abortHandler = () => this.finish(new Error("RPC subprocess aborted."), true);
		if (options.signal?.aborted) {
			this.closed = true;
			throw new Error("RPC subprocess aborted.");
		}
		this.child = spawn(options.executable, options.args, {
			cwd: options.cwd, env: options.env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
		});
		this.child.stderr.on("data", () => { /* Drain silently; stderr may contain credentials. */ });
		this.child.stdin.on("error", () => this.finish(new Error("RPC subprocess connection failed."), true));
		this.child.stdout.on("data", (chunk: Buffer) => this.read(chunk));
		this.child.on("error", () => this.finish(new Error("RPC subprocess failed."), false));
		this.child.on("exit", () => this.finish(new Error("RPC subprocess exited."), false));
		options.signal?.addEventListener("abort", this.abortHandler, { once: true });
		this.child.on("close", () => options.signal?.removeEventListener("abort", this.abortHandler));
		this.requestTimeoutMs = options.requestTimeoutMs;
	}

	private readonly requestTimeoutMs?: number;

	request(method: string, params?: unknown): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("RPC subprocess is closed."));
		const id = `${process.pid}:${++this.counter}:${randomUUID()}`;
		return new Promise((resolve, reject) => {
			const pending: Pending = { resolve, reject };
			if (this.requestTimeoutMs !== undefined && this.requestTimeoutMs > 0) {
				pending.timer = setTimeout(() => {
					if (!this.pending.delete(id)) return;
					reject(new Error("RPC request timed out."));
				}, this.requestTimeoutMs);
			}
			this.pending.set(id, pending);
			if (!this.write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })) {
				this.pending.delete(id);
				if (pending.timer) clearTimeout(pending.timer);
				reject(new Error("RPC subprocess is closed."));
			}
		});
	}

	notify(method: string, params?: unknown): void {
		this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
	}

	replyError(id: string | number, message: string): void {
		this.write({ jsonrpc: "2.0", id, error: { code: -32603, message } });
	}

	replyResult(id: string | number, result: unknown): void {
		this.write({ jsonrpc: "2.0", id, result });
	}

	onMessage(listener: (message: Record<string, unknown>) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onClose(listener: (error: Error) => void): () => void {
		if (this.closed) { listener(new Error("RPC subprocess is closed.")); return () => {}; }
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	close(): void { this.finish(new Error("RPC subprocess closed."), true); }

	private write(message: Record<string, unknown>): boolean {
		if (this.closed || !this.child.stdin.writable) return false;
		try { this.child.stdin.write(`${JSON.stringify(message)}\n`); return true; }
		catch { return false; }
	}

	private read(chunk: Buffer): void {
		if (this.closed) return;
		this.buffer = Buffer.concat([this.buffer, chunk]);
		let newline: number;
		while ((newline = this.buffer.indexOf(0x0a)) !== -1) {
			if (newline > MAX_LINE_BYTES) { this.finish(new Error("RPC message exceeds the maximum size."), true); return; }
			const line = this.buffer.subarray(0, newline);
			this.buffer = this.buffer.subarray(newline + 1);
			if (line.length) this.parse(line);
			if (this.closed) return;
		}
		if (this.buffer.length > MAX_LINE_BYTES) this.finish(new Error("RPC message exceeds the maximum size."), true);
	}

	private parse(line: Buffer): void {
		let value: unknown;
		try { value = JSON.parse(line.toString("utf8")); }
		catch { this.finish(new Error("RPC subprocess returned invalid data."), true); return; }
		if (!value || typeof value !== "object" || Array.isArray(value)) return;
		const message = value as Record<string, unknown>;
		if ((typeof message.id === "string" || typeof message.id === "number") && ("result" in message || "error" in message)) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (pending.timer) clearTimeout(pending.timer);
			if (message.error && typeof message.error === "object") {
				pending.reject(new Error("RPC request failed."));
			} else pending.resolve(message.result);
			return;
		}
		for (const listener of this.listeners) {
			try { listener(message); } catch { /* A consumer cannot break transport parsing. */ }
		}
	}

	private finish(error: Error, terminate: boolean): void {
		if (this.closed) return;
		this.closed = true;
		for (const pending of this.pending.values()) {
			if (pending.timer) clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		this.listeners.clear();
		for (const listener of this.closeListeners) { try { listener(error); } catch { /* Cleanup is independent of consumers. */ } }
		this.closeListeners.clear();
		if (terminate) {
			this.child.stdin.destroy();
			this.child.kill();
		}
	}
}
