"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PlayIcon, SquareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { indentCode } from "@/src/core";

type Language = "javascript" | "typescript" | "python";
type DraftSet = Record<Language, string>;
type SaveState = "loading" | "saving" | "saved" | "error" | "conflict";
const examples: Record<Language, string> = {
	javascript: 'function greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("world"));',
	typescript: 'function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("world"));',
	python: 'def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("world"))',
};
const emptyTests: DraftSet = { javascript: "", typescript: "", python: "" };
const snapshotOf = (drafts: DraftSet, tests: DraftSet) => JSON.stringify({ drafts, tests });
const validSet = (value: unknown): value is DraftSet => !!value && typeof value === "object" &&
	(["javascript", "typescript", "python"] as const).every((key) => typeof (value as DraftSet)[key] === "string" && (value as DraftSet)[key].length <= 100_000);

// The worker is created inside an opaque-origin sandboxed iframe. Its CSP
// denies network access except to the bundled Python runtime, and it never
// receives access to the host page, the app's files, or its API.
const workerSource = `
self.onmessage = async ({data}) => {
  const send = (kind, text) => self.postMessage({kind, text: String(text)});
  const format = value => typeof value === "string" ? value : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
  const output = {log: (...items) => send("out", items.map(format).join(" ")), info: (...items) => send("out", items.map(format).join(" ")), warn: (...items) => send("err", items.map(format).join(" ")), error: (...items) => send("err", items.map(format).join(" "))};
  try {
    if (data.language === "python") {
      send("status", "Starting Python…");
      importScripts(data.runtime + "pyodide.js");
      const python = await loadPyodide({indexURL: data.runtime, stdout: text => send("out", text), stderr: text => send("err", text)});
      await python.runPythonAsync(data.code);
    } else {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      await new AsyncFunction("console", data.code)(output);
    }
    send("done", "Finished");
  } catch (error) { send("error", error && error.message ? error.message : String(error)); }
};
`;

function runnerDocument(origin: string): string {
	const runtime = `${origin}/python-runtime/`;
	const csp = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: ${runtime}; worker-src blob:; connect-src ${runtime}; img-src 'none'; style-src 'none';`;
	const script = `
const source = ${JSON.stringify(workerSource).replace(/</g, "\\u003c")};
let worker;
window.onmessage = event => {
  if (event.source !== parent || !event.data || event.data.type !== "run") return;
  const {id, code, language, runtime} = event.data;
  worker?.terminate();
  worker = new Worker(URL.createObjectURL(new Blob([source], {type: "text/javascript"})));
  const started = performance.now();
  const report = (kind, text) => parent.postMessage({type: "learnins-run", id, kind, text}, "*");
  const timer = setTimeout(() => { worker.terminate(); report("error", "Execution timed out."); }, language === "python" ? 60000 : 10000);
  worker.onmessage = e => { const done = e.data.kind === "done"; report(e.data.kind, done ? "Finished in " + Math.round(performance.now() - started) + " ms" : e.data.text); if (done || e.data.kind === "error") { clearTimeout(timer); worker.terminate(); } };
  worker.onerror = e => { clearTimeout(timer); report("error", e.message || "Worker failed."); worker.terminate(); };
  worker.postMessage({code, language, runtime});
};
`;
	return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${script}<\/script>`;
}

export function CodingWorkspace({ onAttachToSession, questionPending = false }: {
	onAttachToSession?: (text: string) => void;
	questionPending?: boolean;
} = {}) {
	const router = useRouter();
	const [language, setLanguage] = useState<Language>("javascript");
	const [drafts, setDrafts] = useState(examples);
	const [tests, setTests] = useState<DraftSet>(emptyTests);
	const [showTests, setShowTests] = useState(false);
	const [loadedDrafts, setLoadedDrafts] = useState(false);
	const [saveState, setSaveState] = useState<SaveState>("loading");
	const [output, setOutput] = useState<string[]>([]);
	const [lastRun, setLastRun] = useState<string | null>(null);
	const [running, setRunning] = useState(false);
	const [copyStatus, setCopyStatus] = useState("");
	const [tabIndents, setTabIndents] = useState(true);
	const [run, setRun] = useState<{ id: string; code: string; language: Language; origin: string } | null>(null);
	const frame = useRef<HTMLIFrameElement>(null);
	const runRef = useRef<string | null>(null);
	const requestRef = useRef<AbortController | null>(null);
	const revisionRef = useRef(0);
	const writableRef = useRef(false);
	const savingRef = useRef(false);
	const queuedRef = useRef<string | null>(null);
	const lastAttemptRef = useRef<string | null>(null);
	const lastSavedRef = useRef(snapshotOf(examples, emptyTests));
	const latestRef = useRef(lastSavedRef.current);
	const currentDraft = JSON.stringify([language, drafts[language], tests[language]]);
	const outputIsStale = lastRun !== null && lastRun !== currentDraft;

	const queueSave = useCallback(async (snapshot: string) => {
		queuedRef.current = snapshot;
		if (savingRef.current || !writableRef.current) return;
		savingRef.current = true;
		while (queuedRef.current && writableRef.current) {
			const next = queuedRef.current;
			queuedRef.current = null;
			lastAttemptRef.current = next;
			try {
				const body = JSON.stringify({ version: 1, revision: revisionRef.current, ...JSON.parse(next) });
				const response = await fetch("/api/study/drafts", {
					method: "PUT", headers: { "content-type": "application/json" },
					keepalive: new TextEncoder().encode(body).length <= 60_000, body,
				});
				if (!response.ok) { writableRef.current = false; setSaveState(response.status === 409 ? "conflict" : "error"); break; }
				const saved = await response.json() as { revision: number };
				revisionRef.current = saved.revision;
				lastSavedRef.current = next;
			} catch { writableRef.current = false; setSaveState("error"); break; }
		}
		savingRef.current = false;
		if (writableRef.current) setSaveState(lastSavedRef.current === latestRef.current ? "saved" : "saving");
	}, []);

	useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const response = await fetch("/api/study/drafts", { cache: "no-store" });
				if (!response.ok) throw new Error("Drafts unavailable");
				const body = await response.json() as { saved: { revision: number; drafts: DraftSet; tests: DraftSet } | null };
				if (!active) return;
				let saved = body.saved;
				if (!saved) {
					try {
						const old = JSON.parse(localStorage.getItem("learnins:coding-drafts") ?? "null") as { drafts?: unknown; tests?: unknown } | null;
						if (validSet(old?.drafts) && validSet(old?.tests)) saved = { revision: 0, drafts: old.drafts, tests: old.tests };
					} catch { /* No usable draft from the previous browser-only storage. */ }
				}
				if (saved) {
					revisionRef.current = saved.revision;
					setDrafts(saved.drafts); setTests(saved.tests);
					latestRef.current = snapshotOf(saved.drafts, saved.tests);
					lastSavedRef.current = body.saved ? latestRef.current : "";
				}
				writableRef.current = true;
				setSaveState("saved");
			} catch { if (active) setSaveState("error"); }
			finally { if (active) setLoadedDrafts(true); }
		})();
		return () => { active = false; if (writableRef.current && latestRef.current !== lastSavedRef.current) void queueSave(latestRef.current); };
	}, [queueSave]);
	useEffect(() => {
		if (!loadedDrafts) return;
		const snapshot = snapshotOf(drafts, tests);
		latestRef.current = snapshot;
		if (!writableRef.current || snapshot === lastSavedRef.current) return;
		setSaveState("saving");
		const timer = setTimeout(() => { void queueSave(snapshot); }, 400);
		return () => clearTimeout(timer);
	}, [drafts, tests, loadedDrafts, queueSave]);
	async function retrySave() {
		setSaveState("saving");
		try {
			const response = await fetch("/api/study/drafts", { cache: "no-store" });
			if (!response.ok) throw new Error("Drafts unavailable");
			const { saved } = await response.json() as { saved: { revision: number; drafts: DraftSet; tests: DraftSet } | null };
			const serverSnapshot = saved ? snapshotOf(saved.drafts, saved.tests) : snapshotOf(examples, emptyTests);
			const revision = saved?.revision ?? 0;
			// A lost response may have committed our last attempt. Any other
			// change belongs to another window and must not be overwritten.
			if (revision !== revisionRef.current && serverSnapshot !== lastAttemptRef.current) { setSaveState("conflict"); return; }
			revisionRef.current = revision;
			lastSavedRef.current = serverSnapshot;
			writableRef.current = true;
			if (latestRef.current === serverSnapshot) setSaveState("saved");
			else await queueSave(latestRef.current);
		} catch { setSaveState("error"); }
	}

	useEffect(() => {
		const receive = (event: MessageEvent) => {
			if (event.source !== frame.current?.contentWindow || event.data?.type !== "learnins-run" || event.data.id !== runRef.current) return;
			const { kind, text } = event.data as { kind: string; text: string };
			setOutput((old) => [...old.slice(-199), `${kind === "error" || kind === "err" ? "Error: " : ""}${String(text).slice(0, 4000)}`]);
			if (kind === "done" || kind === "error") { setRunning(false); runRef.current = null; }
		};
		window.addEventListener("message", receive);
		return () => window.removeEventListener("message", receive);
	}, []);
	async function execute() {
		if (running) return;
		const id = crypto.randomUUID();
		const controller = new AbortController();
		runRef.current = id;
		requestRef.current = controller;
		setRunning(true); setCopyStatus(""); setOutput([]); setLastRun(currentDraft);
		let code = `${drafts[language]}\n\n${tests[language]}`;
		if (language === "typescript") {
			try {
				const response = await fetch("/api/study/transpile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }), signal: controller.signal });
				const result = await response.json();
				if (!response.ok) throw new Error(result.error || "Could not convert TypeScript.");
				code = result.code;
			} catch (error) {
				if (runRef.current === id) { setOutput([error instanceof Error ? error.message : "Could not convert TypeScript."]); setRunning(false); runRef.current = null; }
				return;
			}
		}
		if (runRef.current !== id) return;
		requestRef.current = null;
		setRun({ id, code, language, origin: window.location.origin });
	}
	function stop() {
		requestRef.current?.abort(); requestRef.current = null;
		setRun(null); runRef.current = null; setRunning(false); setOutput((old) => [...old, "Stopped."]);
	}
	function tutorMessage() {
		return `Help me understand and improve this ${language} code. Explain my mistakes and guide me through fixing them.\n\nCode:\n\`\`\`${language}\n${drafts[language]}\n\`\`\`\n\nTests:\n\`\`\`${language}\n${tests[language] || "(none)"}\n\`\`\`\n\nOutput:\n${outputIsStale ? "(the current code has not been run)" : output.join("\n") || "(not run yet)"}`;
	}
	async function shareWithTutor() {
		const message = tutorMessage();
		if (onAttachToSession && questionPending) {
			try { await navigator.clipboard.writeText(message); setCopyStatus("Copied. Paste it into your answer when you return to the lesson."); }
			catch { setCopyStatus("Could not copy automatically. Select the code and output to copy them."); }
		} else if (onAttachToSession) {
			onAttachToSession(message);
		} else {
			sessionStorage.setItem("learnins:starter", message);
			router.push("/chat/new");
		}
	}
	function handleIndent(event: React.KeyboardEvent<HTMLTextAreaElement>, target: "code" | "tests") {
		if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "m") {
			event.preventDefault(); event.stopPropagation(); setTabIndents((value) => !value); return;
		}
		if (!tabIndents || event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
		event.preventDefault(); event.stopPropagation();
		const input = event.currentTarget;
		const next = indentCode(input.value, input.selectionStart, input.selectionEnd, event.shiftKey);
		if (next.value.length > 100_000) return;
		setCopyStatus("");
		if (target === "code") setDrafts((old) => ({ ...old, [language]: next.value }));
		else setTests((old) => ({ ...old, [language]: next.value }));
		requestAnimationFrame(() => input.setSelectionRange(next.start, next.end));
	}
	return <div className="space-y-5">
		<div className="flex flex-wrap items-center justify-between gap-3">
			<div className="flex gap-1 rounded-md border border-border bg-card p-1" aria-label="Programming language">
				{(["javascript", "typescript", "python"] as const).map((item) => <button key={item} type="button" aria-pressed={language === item} onClick={() => { setLanguage(item); setCopyStatus(""); }} disabled={running} className={`min-h-10 rounded px-3 py-1.5 text-sm ${language === item ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{item === "javascript" ? "JavaScript" : item === "typescript" ? "TypeScript" : "Python"}</button>)}
			</div>
			{running ? <button type="button" onClick={stop} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm"><SquareIcon className="size-4" />Stop</button> :
				<button type="button" disabled={!loadedDrafts} onClick={() => void execute()} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"><PlayIcon className="size-4" />Run code</button>}
		</div>
		{(saveState === "error" || saveState === "conflict") && <p role="alert" className="text-sm text-amber-300">{saveState === "conflict" ? "This draft changed in another window." : "Your draft could not be saved."} Copy your work before leaving this page. {saveState === "error" && <button type="button" onClick={() => void retrySave()} className="underline underline-offset-2">Retry saving</button>}</p>}
		<div className="grid gap-5 lg:grid-cols-2">
			<section className="overflow-hidden rounded-lg border border-border bg-card"><div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm font-medium"><span>Editor</span><span role="status" className="text-xs font-normal text-muted-foreground">{saveState === "loading" ? "Loading…" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved locally" : "Not saved"}</span></div>
				<textarea aria-label="Code editor" aria-describedby="code-tab-help" disabled={!loadedDrafts} maxLength={100_000} spellCheck={false} value={drafts[language]} onChange={(e) => { setCopyStatus(""); setDrafts((old) => ({ ...old, [language]: e.target.value })); }} onKeyDown={(e) => handleIndent(e, "code")} className="min-h-[380px] w-full resize-y bg-transparent p-4 font-mono text-sm leading-6 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400" />
			</section>
			<section className="overflow-hidden rounded-lg border border-border bg-card"><div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm font-medium"><span>Output</span>{outputIsStale && <span className="text-xs font-normal text-amber-300">From an earlier run</span>}</div>
				<pre aria-live="polite" className="min-h-[380px] whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6 text-muted-foreground">{output.length ? output.join("\n") : "Run your code to see the output here."}</pre>
			</section>
		</div>
		<div className="flex flex-wrap gap-2">
			<button type="button" onClick={() => setShowTests((value) => !value)} className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent">{showTests ? "Hide tests" : "Add tests"}</button>
			<button type="button" disabled={running || !loadedDrafts} onClick={() => void shareWithTutor()} className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50">{onAttachToSession ? questionPending ? "Copy for your answer" : "Add to your reply" : "Ask the tutor about this code"}</button>
		</div>
		{copyStatus && <p role="status" className="text-sm text-muted-foreground">{copyStatus}</p>}
		{showTests && <section className="rounded-lg border border-border bg-card p-4">
			<label className="block text-sm font-medium">Tests to run after your code
				<textarea aria-label="Code tests" aria-describedby="code-tab-help" disabled={!loadedDrafts} maxLength={100_000} spellCheck={false} value={tests[language]} onChange={(e) => { setCopyStatus(""); setTests((old) => ({ ...old, [language]: e.target.value })); }}
					onKeyDown={(e) => handleIndent(e, "tests")}
					placeholder={language === "python" ? 'assert greet("Ada") == "Hello, Ada!"' : 'if (greet("Ada") !== "Hello, Ada!") throw new Error("Test failed");'}
					className="mt-3 min-h-28 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-sm leading-6" />
			</label>
			<p className="mt-2 text-xs text-muted-foreground">Write assertions in the selected language. A thrown error or failed assertion appears in Output.</p>
		</section>}
		<p id="code-tab-help" role="status" className="text-xs leading-5 text-muted-foreground">{tabIndents ? "Tab indents code" : "Tab moves focus"} · Ctrl+M switches this behavior.</p>
		<p className="text-xs leading-5 text-muted-foreground">Code runs in an isolated browser worker with a time limit. Python uses the bundled runtime; files and external network access are unavailable.</p>
		{run && <iframe key={run.id} ref={frame} title="Isolated code runner" sandbox="allow-scripts" className="hidden" srcDoc={runnerDocument(run.origin)} onLoad={() => frame.current?.contentWindow?.postMessage({ type: "run", ...run, runtime: `${run.origin}/python-runtime/` }, "*")} />}
	</div>;
}
