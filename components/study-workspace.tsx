"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenIcon, CalendarDaysIcon, ChevronRightIcon, Code2Icon, FileTextIcon, Layers3Icon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { SidebarToggle } from "@/components/sidebar";
import { postNotesImport } from "@/components/notes-import";
import { calendarFile, googleCalendarUrl, planExam, reviewCard, type ChatListItem, type GraphSnapshot, type Rating, type StudyCard, type StudyData, type StudyDeck, type StudyMaterial } from "@/src/core";
import { CodingWorkspace } from "@/components/study-coding";

export type StudySection = "materials" | "flashcards" | "planner" | "coding" | "projects";
const sections = {
	projects: { title: "Projects", description: "Keep your files and notes together.", icon: BookOpenIcon },
	materials: { title: "Materials", description: "Keep course files and transcripts close to your learning sessions.", icon: FileTextIcon },
	flashcards: { title: "Flashcards", description: "Practise the facts and vocabulary you want to remember.", icon: Layers3Icon },
	planner: { title: "Study planner", description: "Make a revision plan for your next exam.", icon: CalendarDaysIcon },
	coding: { title: "Coding practice", description: "Experiment with code and learn from the result.", icon: Code2Icon },
} as const;
const field = "w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-blue-400";
const button = "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
const primary = "inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50";

function useStudy() {
	const [data, setData] = useState<StudyData | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const dataRef = useRef<StudyData | null>(null);
	const pending = useRef(false);
	const load = useCallback(async () => {
		try {
			const response = await fetch("/api/study", { cache: "no-store" });
			const body = await response.json();
			if (!response.ok) throw new Error(body.error || "Could not load study data.");
			dataRef.current = body;
			setData(body);
		} catch (err) { setError(err instanceof Error ? err.message : "Could not load study data."); }
	}, []);
	useEffect(() => { void load(); }, [load]);
	const save = async (change: (current: StudyData) => StudyData): Promise<boolean> => {
		if (!dataRef.current || pending.current) return false;
		pending.current = true;
		setBusy(true);
		setError("");
		try {
			const next = change(dataRef.current);
			const response = await fetch("/api/study", {
				method: "PUT", headers: { "content-type": "application/json" },
				// Material text can be large; the server preserves the authoritative
				// library at this revision while saving cards and plans.
				body: JSON.stringify({ version: next.version, revision: next.revision, decks: next.decks, exams: next.exams, projects: next.projects }),
			});
			const body = await response.json();
			if (!response.ok) {
				if (response.status === 409) await load();
				throw new Error(body.error || "Could not save study data.");
			}
			dataRef.current = body;
			setData(body);
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save study data.");
			return false;
		} finally { pending.current = false; setBusy(false); }
	};
	const updateMaterial = async (method: "POST" | "DELETE", input: File | string): Promise<StudyData | null> => {
		if (!dataRef.current || pending.current) return null;
		pending.current = true; setBusy(true); setError("");
		try {
			let body: BodyInit;
			let headers: HeadersInit | undefined;
			if (method === "POST") {
				const form = new FormData(); form.append("file", input as File); form.append("revision", String(dataRef.current.revision)); body = form;
			} else {
				headers = { "content-type": "application/json" }; body = JSON.stringify({ id: input, revision: dataRef.current.revision });
			}
			const response = await fetch("/api/study/materials", { method, body, headers });
			const result = await response.json();
			if (!response.ok) {
				if (response.status === 409) await load();
				throw new Error(result.error || "Could not update the material.");
			}
			const next = method === "DELETE" ? result.data : result;
			dataRef.current = next;
			setData(next);
			if (result.cleanupFailed) setError("The library entry was removed, but a local file could not be deleted. Check the materials folder in your data directory.");
			return next;
		} catch (err) { setError(err instanceof Error ? err.message : "Could not update the material."); return null; }
		finally { pending.current = false; setBusy(false); }
	};
	return { data, busy, error, setError, save, load, updateMaterial };
}
type StudyController = ReturnType<typeof useStudy>;

export function StudyWorkspace({ section }: { section: StudySection }) {
	const study = useStudy();
	const info = sections[section];
	const Icon = info.icon;
	return (
		<div data-native-tab className="flex h-dvh min-w-0 flex-col bg-background">
			<header className="lh-drag lh-wco-gutter flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
				<SidebarToggle />
				<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
				<span className="text-sm font-medium">{info.title}</span>
			</header>
			<main className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
					<div className="mb-8">
						<h1 className="text-2xl font-semibold tracking-tight">{info.title}</h1>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">{info.description}</p>
					</div>
					{study.error && <div role="alert" className="mb-5 rounded-md border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">{study.error} <button type="button" className="ml-2 underline" onClick={() => { study.setError(""); void study.load(); }}>Reload</button></div>}
					{section === "coding" ? <CodingWorkspace /> : !study.data ? <p role="status" className="text-sm text-muted-foreground">{study.error ? "Study data is unavailable." : "Loading your study space…"}</p> :
						section === "projects" ? <Projects study={study} /> : section === "materials" ? <Materials study={study} /> :
						section === "flashcards" ? <Flashcards study={study} /> : <Planner study={study} />}
				</div>
			</main>
		</div>
	);
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
	return <section className={`rounded-lg border border-border bg-card ${className}`}>{children}</section>;
}

function Projects({ study }: { study: StudyController }) {
	const [selected, setSelected] = useState("");
	const [newName, setNewName] = useState("");
	const [dirty, setDirty] = useState(false);
	const [chats, setChats] = useState<ChatListItem[]>([]);
	const [moving, setMoving] = useState(false);
	const project = study.data!.projects.find((item) => item.id === selected);
	const loadChats = useCallback(async () => {
		try { const response = await fetch("/api/chats", { cache: "no-store" }); if (!response.ok) throw new Error(); const body = await response.json(); setChats(body.chats); }
		catch { study.setError("Sessions could not be loaded."); }
	}, [study.setError]);
	useEffect(() => { void loadChats(); }, [loadChats]);
	async function moveChat(id: string, projectId: string | null) {
		if (moving || !id) return;
		setMoving(true);
		try {
			const response = await fetch(`/api/chats/${encodeURIComponent(id)}/project`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId }) });
			if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Could not move session."); }
			await loadChats();
		} catch (error) { study.setError(error instanceof Error ? error.message : "Could not move session."); }
		finally { setMoving(false); }
	}
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);
	async function create(event: React.FormEvent) {
		event.preventDefault();
		const name = newName.trim();
		if (!name) return;
		if (dirty && !confirm("Discard unsaved project details?")) return;
		const id = crypto.randomUUID();
		if (await study.save((data) => ({ ...data, projects: [...data.projects, { id, name, notes: "", materialIds: [] }] }))) { setNewName(""); setDirty(false); setSelected(id); }
	}
	return <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
		<div className="space-y-4"><form onSubmit={create} className="flex gap-2"><input className={field} aria-label="New project name" placeholder="New project name" maxLength={200} value={newName} onChange={(e) => setNewName(e.target.value)} /><button className={primary} disabled={study.busy || !newName.trim()} aria-label="Create project"><PlusIcon className="size-4" /></button></form>
			<nav aria-label="Projects" className="space-y-1">{study.data!.projects.map((item) => <button type="button" key={item.id} onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-learnins-chat")) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }} onDrop={(e) => { e.preventDefault(); void moveChat(e.dataTransfer.getData("application/x-learnins-chat"), item.id); }} onClick={() => { if (item.id === selected) return; if (dirty && !confirm("Discard unsaved project details?")) return; setDirty(false); setSelected(item.id); }} aria-current={selected === item.id ? "page" : undefined} className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent ${selected === item.id ? "bg-accent font-medium" : "text-muted-foreground"}`}>{item.name}</button>)}</nav>
			<p className="text-xs leading-5 text-muted-foreground">Drag a session from the sidebar onto a project, or use the session selector inside a project.</p>
		</div>
		{project ? <ProjectDetails key={project.id} project={project} study={study} chats={chats} moving={moving} moveChat={moveChat} setDirty={setDirty} onDelete={() => { setDirty(false); setSelected(""); }} /> : <Panel className="p-8"><h2 className="font-semibold">Your projects</h2><p className="mt-2 text-sm text-muted-foreground">Create a project or select one to manage its notes and files.</p></Panel>}
	</div>;
}

function ProjectDetails({ project, study, chats, moving, moveChat, onDelete, setDirty }: { project: StudyData["projects"][number]; study: StudyController; chats: ChatListItem[]; moving: boolean; moveChat: (id: string, projectId: string | null) => Promise<void>; onDelete: () => void; setDirty: (value: boolean) => void }) {
	const router = useRouter();
	const [name, setName] = useState(project.name);
	const [notes, setNotes] = useState(project.notes);
	const [uploading, setUploading] = useState(false);
	const [expanded, setExpanded] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const update = (change: (current: typeof project) => typeof project) => study.save((data) => ({ ...data, projects: data.projects.map((item) => item.id === project.id ? change(item) : item) }));
	async function upload(files: FileList | null) {
		if (!files?.length) return;
		setUploading(true);
		try {
			for (const file of Array.from(files)) {
				const result = await study.updateMaterial("POST", file);
				if (!result) break;
				const added = result.materials.at(-1);
				if (added && !await update((item) => ({ ...item, materialIds: [...item.materialIds, added.id] }))) break;
			}
		} finally { setUploading(false); if (input.current) input.current.value = ""; }
	}
	const materials = study.data!.materials;
	return <div className="space-y-6"><Panel className="space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Sessions</h2><p className="mt-1 text-sm text-muted-foreground">Organize teaching and practice sessions in this project.</p></div><div className="flex gap-2"><button type="button" className={button} onClick={() => router.push(`/chat/new?project=${encodeURIComponent(project.id)}`)}>New teaching</button><button type="button" className={button} onClick={() => router.push(`/chat/new?mode=practice&project=${encodeURIComponent(project.id)}`)}>New practice</button></div></div>
		{chats.filter((c) => c.projectId === project.id).length === 0 ? <p className="text-sm text-muted-foreground">No sessions in this project yet.</p> : <ul className="space-y-2">{chats.filter((c) => c.projectId === project.id).map((chat) => <li key={chat.id} className="flex items-center gap-2 rounded-md border border-border p-3"><button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:underline" onClick={() => router.push(`/chat/${chat.id}`)}>{chat.title}</button><button type="button" className={button} disabled={moving} onClick={() => void moveChat(chat.id, null)}>Remove</button></li>)}</ul>}
		{chats.some((c) => c.projectId !== project.id) && <label className="block text-sm font-medium">Add an existing session<select className={`mt-2 ${field}`} value="" disabled={moving} onChange={(e) => { if (e.target.value) void moveChat(e.target.value, project.id); }}><option value="">Choose a session…</option>{chats.filter((c) => c.projectId !== project.id).map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</select></label>}
	</Panel><Panel className="space-y-4 p-5"><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (name.trim()) void update((item) => ({ ...item, name: name.trim(), notes })).then((ok) => { if (ok) setDirty(false); }); }}>
		<label className="block text-sm font-medium">Project name<input className={`mt-2 ${field}`} value={name} maxLength={200} required disabled={study.busy} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></label>
		<label className="block text-sm font-medium">Notes<textarea className={`mt-2 min-h-40 ${field}`} value={notes} maxLength={100000} disabled={study.busy} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="Add information about this project…" /></label>
		<div className="flex flex-wrap gap-2"><button className={primary} disabled={study.busy || !name.trim()}>Save details</button><button type="button" className={button} disabled={study.busy} onClick={() => { if (confirm(`Delete project “${project.name}”? Its sessions and files will remain available.`)) void study.save((data) => ({ ...data, projects: data.projects.filter((item) => item.id !== project.id) })).then((ok) => { if (ok) onDelete(); }); }}>Delete project</button></div>
	</form></Panel>
	<Panel className="space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Files</h2><p className="mt-1 text-sm text-muted-foreground">Upload files or attach items from Materials. Files stay in your local library.</p></div><input ref={input} type="file" multiple className="sr-only" onChange={(e) => void upload(e.target.files)} /><button type="button" className={button} disabled={study.busy || uploading} onClick={() => input.current?.click()}><UploadIcon className="size-4" />{uploading ? "Uploading…" : "Upload files"}</button></div>
		<p className="text-xs text-muted-foreground">PDF, Word, PowerPoint, images, text, Markdown, CSV, code and VTT/SRT; up to 20 MB per file.</p>
		{project.materialIds.length === 0 && <p className="text-sm text-muted-foreground">No files attached yet.</p>}
		<ul className="space-y-2">{project.materialIds.map((id) => { const material = materials.find((item) => item.id === id); return <li key={id} className="rounded-md border border-border p-3"><div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-all text-sm">{material?.name ?? "File removed from Materials"}</span>{material && <><button type="button" className={button} onClick={() => setExpanded(expanded === id ? "" : id)}>{expanded === id ? "Hide text" : "View text"}</button>{material.originalExtension && <a className={button} href={`/api/study/materials/download?id=${encodeURIComponent(id)}`}>Download</a>}</>}<button type="button" className={button} disabled={study.busy} onClick={() => void update((item) => ({ ...item, materialIds: item.materialIds.filter((value) => value !== id) }))}>Detach</button></div>{material && expanded === id && <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">{material.text || "No text was extracted from this file."}</pre>}</li>; })}</ul>
		{materials.some((item) => !project.materialIds.includes(item.id)) && <label className="block text-sm font-medium">Attach an existing file<select className={`mt-2 ${field}`} value="" disabled={study.busy} onChange={(e) => { const id = e.target.value; if (id) void update((item) => ({ ...item, materialIds: [...item.materialIds, id] })); }}><option value="">Choose a file…</option>{materials.filter((item) => !project.materialIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
	</Panel></div>;
}

function Flashcards({ study }: { study: StudyController }) {
	const data = study.data!;
	const [selected, setSelected] = useState("");
	const [deckName, setDeckName] = useState("");
	const [renaming, setRenaming] = useState(false);
	const [renamed, setRenamed] = useState("");
	const [front, setFront] = useState("");
	const [back, setBack] = useState("");
	const [pairs, setPairs] = useState("");
	const [revealed, setRevealed] = useState(false);
	const [message, setMessage] = useState("");
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => { try { setSelected(localStorage.getItem("learnins:selected-deck") ?? ""); } catch { /* optional preference */ } }, []);
	useEffect(() => { if (selected) try { localStorage.setItem("learnins:selected-deck", selected); } catch { /* optional preference */ } }, [selected]);
	const deck = data.decks.find((item) => item.id === selected) ?? data.decks[0];
	const due = deck?.cards.filter((card) => Date.parse(card.dueAt) <= now) ?? [];
	const current = due[0];
	const nextDue = deck?.cards.map((card) => Date.parse(card.dueAt)).filter((time) => time > now).sort((a, b) => a - b)[0];
	useEffect(() => {
		if (!nextDue) return;
		const timer = window.setTimeout(() => setNow(Date.now()), Math.min(nextDue - Date.now() + 100, 2_147_000_000));
		return () => window.clearTimeout(timer);
	}, [nextDue]);
	const updateDeck = (fn: (item: StudyDeck) => StudyDeck) =>
		study.save((value) => ({ ...value, decks: value.decks.map((item) => item.id === deck?.id ? fn(item) : item) }));

	async function createDeck(e: React.FormEvent) {
		e.preventDefault();
		const name = deckName.trim();
		if (!name) return;
		const item: StudyDeck = { id: crypto.randomUUID(), name, cards: [] };
		if (await study.save((value) => ({ ...value, decks: [...value.decks, item] }))) {
			setDeckName(""); setSelected(item.id); setRevealed(false);
		}
	}
	async function addCards(values: Array<{ front: string; back: string; sourceNodeId?: string }>) {
		const cards: StudyCard[] = values.map((value) => ({ ...value, id: crypto.randomUUID(), dueAt: new Date().toISOString(), intervalMinutes: 0 }));
		if (!cards.length) return false;
		return updateDeck((item) => ({ ...item, cards: [...item.cards, ...cards] }));
	}
	async function addFromGraph() {
		setMessage("");
		try {
			const response = await fetch("/api/graph");
			if (!response.ok) throw new Error("Could not read the knowledge graph.");
			const graph: GraphSnapshot = await response.json();
			const existing = new Set(deck?.cards.map((card) => card.sourceNodeId));
			const values = graph.propositions.filter((node) => !existing.has(node.id)).map((node) => ({ front: node.name, back: node.statement, sourceNodeId: node.id }));
			if (!values.length) { setMessage("No new propositions to add from the knowledge graph."); return; }
			if (await addCards(values)) setMessage(`Added ${values.length} cards from your knowledge graph.`);
		} catch (err) { study.setError(err instanceof Error ? err.message : "Could not read the knowledge graph."); }
	}
	async function rate(rating: Rating) {
		if (!current) return;
		if (await updateDeck((item) => ({ ...item, cards: item.cards.map((card) => card.id === current.id ? reviewCard(card, rating) : card) }))) { setRevealed(false); setNow(Date.now()); }
	}

	return <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
		<aside>
			<div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Your decks</h2><span className="text-xs text-muted-foreground">{data.decks.length}</span></div>
			<div className="space-y-1">
				{data.decks.map((item) => <button key={item.id} type="button" onClick={() => { setSelected(item.id); setRevealed(false); setMessage(""); setRenaming(false); }} aria-pressed={deck?.id === item.id}
					className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm ${deck?.id === item.id ? "bg-blue-500/15 text-blue-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
					<span className="truncate">{item.name}</span><span className="ml-2 text-xs">{item.cards.length}</span>
				</button>)}
				{!data.decks.length && <p className="px-3 py-2 text-sm text-muted-foreground">Create your first deck below.</p>}
			</div>
			<form onSubmit={createDeck} className="mt-5 flex gap-2">
				<input aria-label="New deck name" value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="New deck name" className={field} />
				<button type="submit" aria-label="Create deck" disabled={study.busy || !deckName.trim()} className={button}><PlusIcon className="size-4" /></button>
			</form>
		</aside>
		{!deck ? <Panel className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
			<Layers3Icon className="mb-4 size-7 text-blue-400" /><h2 className="font-semibold">Make a deck to get started</h2>
			<p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Add vocabulary, definitions or facts, then review them at spaced intervals.</p>
		</Panel> : <div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>{renaming ? <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (renamed.trim()) void updateDeck((item) => ({ ...item, name: renamed.trim() })).then((ok) => { if (ok) setRenaming(false); }); }}><input aria-label="Deck name" className={field} value={renamed} onChange={(event) => setRenamed(event.target.value)} /><button className={button} disabled={study.busy || !renamed.trim()}>Save</button><button type="button" className={button} onClick={() => setRenaming(false)}>Cancel</button></form> : <h2 className="text-lg font-semibold">{deck.name}</h2>}<p className="mt-1 text-sm text-muted-foreground">{deck.cards.length} {deck.cards.length === 1 ? "card" : "cards"} · {due.length} due now</p></div>
				<div className="flex gap-2"><button type="button" className={button} onClick={() => { setRenamed(deck.name); setRenaming(true); }}>Rename</button><button type="button" className={button} disabled={study.busy} onClick={() => { if (confirm(`Delete “${deck.name}” and its cards?`)) void study.save((value) => ({ ...value, decks: value.decks.filter((item) => item.id !== deck.id) })); }}><Trash2Icon className="size-4" /> Delete deck</button></div>
			</div>
			<Panel className="p-6">
				{current ? <>
					<p className="mb-4 text-xs font-medium text-muted-foreground">CARD {deck.cards.findIndex((item) => item.id === current.id) + 1} OF {deck.cards.length}</p>
					<div className="flex min-h-36 items-center justify-center whitespace-pre-wrap text-center text-lg font-medium">{revealed ? current.back : current.front}</div>
					{!revealed ? <button type="button" className={primary} onClick={() => setRevealed(true)}>Show answer</button> :
						<div><p className="mb-3 text-sm text-muted-foreground">How well did you remember?</p><div className="flex flex-wrap gap-2">
							{(["again", "hard", "good", "easy"] as const).map((rating) => {
								const interval = reviewCard(current, rating).intervalMinutes;
								const days = Math.round(interval / 1440);
								const when = interval < 60 ? `${interval} min` : interval < 1440 ? `${Math.round(interval / 60)} hr` : `${days} ${days === 1 ? "day" : "days"}`;
								return <button key={rating} type="button" data-testid={`rate-${rating}`} disabled={study.busy} className={button} onClick={() => void rate(rating)}>{rating[0]!.toUpperCase() + rating.slice(1)} <span className="text-xs text-muted-foreground">{when}</span></button>;
							})}
						</div></div>}
				</> : <div className="py-8 text-center"><h3 className="font-semibold">{deck.cards.length ? "You're caught up" : "No cards in this deck yet"}</h3><p className="mt-2 text-sm text-muted-foreground">{deck.cards.length && nextDue ? `Next card: ${new Date(nextDue).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.` : "Add a card below or bring in propositions from your graph."}</p></div>}
			</Panel>
			<div className="grid gap-6 xl:grid-cols-2">
				<Panel className="p-5"><h3 className="font-semibold">Add a card</h3><form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (front.trim() && back.trim()) void addCards([{ front: front.trim(), back: back.trim() }]).then((ok) => { if (ok) { setFront(""); setBack(""); } }); }}>
					<label className="block text-sm text-muted-foreground">Front<input className={`mt-1.5 ${field}`} value={front} onChange={(e) => setFront(e.target.value)} placeholder="Question or word" /></label>
					<label className="block text-sm text-muted-foreground">Back<textarea className={`mt-1.5 min-h-20 ${field}`} value={back} onChange={(e) => setBack(e.target.value)} placeholder="Answer or translation" /></label>
					<button className={primary} disabled={study.busy || !front.trim() || !back.trim()}>Add card</button>
				</form></Panel>
				<Panel className="p-5"><h3 className="font-semibold">Bring in cards</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Paste one front and back per line, separated by a tab.</p>
					<textarea className={`mt-4 min-h-24 ${field}`} aria-label="Tab-separated cards" value={pairs} onChange={(e) => setPairs(e.target.value)} placeholder={"hello\thallo\nthank you\tdank je"} />
					<div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} disabled={study.busy || !pairs.trim()} onClick={() => {
						const values = pairs.split(/\r?\n/).map((line) => line.split("\t")).filter((row) => row.length >= 2 && row[0]?.trim() && row.slice(1).join("\t").trim()).map((row) => ({ front: row[0]!.trim(), back: row.slice(1).join("\t").trim() }));
						if (!values.length) { setMessage("Use a tab between the front and back of each card."); return; }
						void addCards(values).then((ok) => { if (ok) { setPairs(""); setMessage(`Added ${values.length} cards.`); } });
					}}>Import pasted cards</button><button type="button" className={button} disabled={study.busy} onClick={() => void addFromGraph()}>Add from graph</button></div>
					{message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
				</Panel>
			</div>
			{deck.cards.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">Manage cards</summary><div className="mt-3 divide-y divide-border rounded-lg border border-border">
				{deck.cards.map((card) => <CardRow key={card.id} card={card} busy={study.busy} onSave={(next) => updateDeck((item) => ({ ...item, cards: item.cards.map((c) => c.id === card.id ? next : c) }))} onDelete={() => { if (confirm("Delete this card?")) void updateDeck((item) => ({ ...item, cards: item.cards.filter((c) => c.id !== card.id) })); }} />)}
			</div></details>}
		</div>}
	</div>;
}

function CardRow({ card, busy, onSave, onDelete }: { card: StudyCard; busy: boolean; onSave: (card: StudyCard) => Promise<boolean>; onDelete: () => void }) {
	const [editing, setEditing] = useState(false);
	const [front, setFront] = useState(card.front);
	const [back, setBack] = useState(card.back);
	return <div className="flex items-start gap-4 px-4 py-3">
		{editing ? <form className="min-w-0 flex-1 space-y-2" onSubmit={(event) => { event.preventDefault(); if (front.trim() && back.trim()) void onSave({ ...card, front: front.trim(), back: back.trim() }).then((ok) => { if (ok) setEditing(false); }); }}>
			<label className="block text-xs text-muted-foreground">Front<input className={`mt-1 ${field}`} value={front} onChange={(event) => setFront(event.target.value)} /></label>
			<label className="block text-xs text-muted-foreground">Back<textarea className={`mt-1 ${field}`} value={back} onChange={(event) => setBack(event.target.value)} /></label>
			<div className="flex gap-2"><button className={primary} disabled={busy || !front.trim() || !back.trim()}>Save card</button><button type="button" className={button} onClick={() => { setFront(card.front); setBack(card.back); setEditing(false); }}>Cancel</button></div>
		</form> : <div className="min-w-0 flex-1"><p className="break-words">{card.front}</p><p className="mt-1 break-words text-muted-foreground">{card.back}</p><button type="button" onClick={() => setEditing(true)} className="mt-2 text-xs text-blue-300 hover:underline">Edit card</button></div>}
		<button type="button" aria-label={`Delete card ${card.front}`} className="text-muted-foreground hover:text-red-300" disabled={busy} onClick={onDelete}><Trash2Icon className="size-4" /></button>
	</div>;
}

function Planner({ study }: { study: StudyController }) {
	const [subject, setSubject] = useState("");
	const [date, setDate] = useState("");
	const [topics, setTopics] = useState("");
	const [minutes, setMinutes] = useState("60");
	const [startTime, setStartTime] = useState("18:00");
	const [latestEndTime, setLatestEndTime] = useState("21:00");
	const [weekdays, setWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
	const [formError, setFormError] = useState("");
	const [formNotice, setFormNotice] = useState("");
	const [calendar, setCalendar] = useState<{ available: boolean; connected: boolean; pending: boolean; authUrl: string | null; message: string | null } | null>(null);
	const [calendarChecking, setCalendarChecking] = useState(false);
	const calendarRequest = useRef(false);
	const [calendarConnectionError, setCalendarConnectionError] = useState("");
	const [addingPlan, setAddingPlan] = useState<string | null>(null);
	const [calendarNotice, setCalendarNotice] = useState<{ examId: string; text: string; error: boolean } | null>(null);
	async function checkCalendar() {
		if (calendarRequest.current) return;
		calendarRequest.current = true;
		setCalendarChecking(true);
		try {
			const response = await fetch("/api/study/calendar");
			if (!response.ok) throw new Error("Unable to check the connection.");
			setCalendar(await response.json());
		} catch { setCalendar({ available: false, connected: false, pending: false, authUrl: null, message: "Unable to check the connection." }); }
		finally { calendarRequest.current = false; setCalendarChecking(false); }
	}
	useEffect(() => { void checkCalendar(); }, []);
	useEffect(() => {
		if (!calendar?.pending) return;
		const timer = setInterval(() => { void checkCalendar(); }, 2500);
		return () => clearInterval(timer);
	}, [calendar?.pending]);
	async function calendarAction(action: "connect" | "cancel" | "disconnect") {
		if (calendarRequest.current) return;
		calendarRequest.current = true; setCalendarChecking(true); setCalendarConnectionError("");
		try {
			const response = await fetch("/api/study/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
			const result = await response.json();
			if (!response.ok) throw new Error(result.error ?? "Unable to change the connection.");
			setCalendar(result);
		} catch (error) { setCalendarConnectionError(error instanceof Error ? error.message : "Unable to change the connection."); }
		finally { calendarRequest.current = false; setCalendarChecking(false); }
	}
	async function addPlanToCalendar(examId: string) {
		if (addingPlan) return;
		setAddingPlan(examId); setCalendarNotice(null);
		try {
			const response = await fetch("/api/study/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ examId }) });
			const result = await response.json() as { added?: number; alreadyAdded?: number; failed?: number; error?: string };
			if (!response.ok) throw new Error(result.error ?? "Could not add this plan.");
			const added = result.added ?? 0, existing = result.alreadyAdded ?? 0, failed = result.failed ?? 0;
			setCalendarNotice({ examId, error: failed > 0, text: `${added} added${existing ? `, ${existing} already in Calendar` : ""}${failed ? `, ${failed} could not be added. Retry to add the rest.` : "."}` });
		} catch (error) { setCalendarNotice({ examId, error: true, text: error instanceof Error ? error.message : "Could not add this plan." }); }
		finally { setAddingPlan(null); }
	}
	function download(events: StudyData["exams"][number]["events"]) {
		const url = URL.createObjectURL(new Blob([calendarFile(events)], { type: "text/calendar;charset=utf-8" }));
		const link = document.createElement("a"); link.href = url; link.download = "learnins-study-plan.ics"; link.click(); URL.revokeObjectURL(url);
	}
	return <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
		<Panel className="h-fit p-5"><h2 className="font-semibold">Plan an exam</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">We'll spread study blocks over the two weeks before your exam.</p>
			<form className="mt-5 space-y-4" onSubmit={(e) => {
				e.preventDefault(); setFormError(""); setFormNotice("");
				try {
					const options = { subject, date, topics: topics.split(/\r?\n/), minutes: Number(minutes), startTime, latestEndTime, weekdays, now: new Date() };
					const possible = planExam(options);
					const plan = planExam({ ...options, occupied: study.data!.exams.flatMap((item) => item.events) });
					if (!plan.events.length) throw new Error("No free study blocks fit before this exam. Change the days or widen the time window.");
					void study.save((value) => ({ ...value, exams: [...value.exams, plan] })).then((ok) => {
						if (!ok) return;
						setSubject(""); setDate(""); setTopics("");
						const notes: string[] = [];
						if (possible.events.length > plan.events.length) notes.push(`Skipped ${possible.events.length - plan.events.length} overlapping blocks.`);
						const moved = plan.events.filter((event) => { const time = new Date(event.start); return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}` !== startTime; }).length;
						if (moved) notes.push(`Moved ${moved} ${moved === 1 ? "block" : "blocks"} later to avoid your other Learnins plans.`);
						if (plan.topics.length > plan.events.length) notes.push("Some sessions cover multiple topics so every topic has time in the plan.");
						setFormNotice(notes.join(" "));
					});
				} catch (err) { setFormError(err instanceof Error ? err.message : "Could not create the plan."); }
			}}>
				<label className="block text-sm text-muted-foreground">Subject<input className={`mt-1.5 ${field}`} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Biology" required /></label>
				<label className="block text-sm text-muted-foreground">Exam date<input type="date" className={`mt-1.5 ${field}`} value={date} onChange={(e) => setDate(e.target.value)} required /></label>
				<label className="block text-sm text-muted-foreground">Topics, one per line<textarea className={`mt-1.5 min-h-24 ${field}`} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={"Cells\nGenetics\nEcology"} required /></label>
				<fieldset><legend className="text-sm text-muted-foreground">Available days</legend><div className="mt-2 flex flex-wrap gap-1.5">{[
					[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"],
				].map(([day, label]) => <label key={day} className={`cursor-pointer rounded-md border px-2 py-1.5 text-xs focus-within:ring-2 focus-within:ring-blue-400 focus-within:ring-offset-2 focus-within:ring-offset-background ${weekdays.includes(day as number) ? "border-blue-500/60 bg-blue-500/15 text-blue-200" : "border-border text-muted-foreground"}`}><input type="checkbox" className="sr-only" checked={weekdays.includes(day as number)} onChange={(event) => setWeekdays((old) => event.target.checked ? [...old, day as number] : old.filter((item) => item !== day))} />{label}</label>)}</div></fieldset>
				<label className="block text-sm text-muted-foreground">Minutes per block<input type="number" min="15" max="480" className={`mt-1.5 ${field}`} value={minutes} onChange={(e) => setMinutes(e.target.value)} required /></label>
				<div className="grid grid-cols-2 gap-3"><label className="block text-sm text-muted-foreground">Start after<input type="time" className={`mt-1.5 ${field}`} value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></label>
				<label className="block text-sm text-muted-foreground">Finish by<input type="time" className={`mt-1.5 ${field}`} value={latestEndTime} onChange={(e) => setLatestEndTime(e.target.value)} required /></label></div>
				<p className="text-xs leading-5 text-muted-foreground">Overlapping blocks move later within this window when there is room.</p>
				{formError && <p role="alert" className="text-sm text-red-300">{formError}</p>}
				{formNotice && <p role="status" className="text-sm text-muted-foreground">{formNotice}</p>}
				<button className={primary} disabled={study.busy}>Create plan</button>
			</form>
		</Panel>
		<div className="space-y-4">
			<div className="flex items-center justify-between"><h2 className="font-semibold">Your plans</h2><span className="text-sm text-muted-foreground">{study.data!.exams.length} {study.data!.exams.length === 1 ? "exam" : "exams"}</span></div>
			<div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/50 px-4 py-3">
				<div className="min-w-[12rem] flex-1"><p className="text-sm font-medium">Google Calendar</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{calendarChecking && !calendar ? "Checking connection…" : calendar?.connected ? "Ready to add a whole plan to your primary calendar." : calendar?.message ?? "Check the connection to add a whole plan."}</p>
					{calendar && !calendar.connected && !calendar.pending && <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Uses a separate sign-in with access to events on calendars you own and basic profile. Requires the Google Workspace CLI and an OAuth client. <a href="https://github.com/googleworkspace/cli#authentication" target="_blank" rel="noreferrer" className="text-blue-300 hover:underline">Setup guide</a></p>}
					{calendar?.pending && calendar.authUrl && <a href={calendar.authUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-blue-300 hover:underline">Open Google sign-in</a>}
					{calendarConnectionError && <p role="alert" className="mt-2 text-xs text-red-300">{calendarConnectionError}</p>}
				</div>
				<div className="flex shrink-0 gap-2">{calendar?.pending ? <button type="button" className={button} disabled={calendarChecking} onClick={() => void calendarAction("cancel")}>Cancel</button> : calendar?.connected ? <button type="button" className={button} disabled={calendarChecking} onClick={() => void calendarAction("disconnect")}>Disconnect</button> : calendar?.available ? <button type="button" className={button} disabled={calendarChecking} onClick={() => void calendarAction("connect")}>Connect Google</button> : <button type="button" className={button} disabled={calendarChecking} onClick={() => void checkCalendar()}>{calendarChecking ? "Checking…" : "Check again"}</button>}</div>
			</div>
			{!study.data!.exams.length && <Panel className="px-6 py-12 text-center"><CalendarDaysIcon className="mx-auto mb-4 size-7 text-blue-400" /><h3 className="font-semibold">No exams planned yet</h3><p className="mt-2 text-sm text-muted-foreground">Add a subject and date to create your first revision schedule.</p></Panel>}
			{study.data!.exams.map((exam) => <Panel key={exam.id} className="overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 p-5">
				<div><h3 className="font-semibold">{exam.subject}</h3><p className="mt-1 text-sm text-muted-foreground">Exam {exam.date} · {exam.events.length} study {exam.events.length === 1 ? "block" : "blocks"}</p></div>
				<div className="flex flex-wrap gap-2">{calendar?.connected && <button type="button" className={button} disabled={!!addingPlan || !exam.events.length} onClick={() => void addPlanToCalendar(exam.id)}>{addingPlan === exam.id ? "Adding…" : "Add plan to Google"}</button>}<button type="button" className={button} onClick={() => download(exam.events)}>Download .ics</button><button type="button" aria-label={`Delete ${exam.subject} plan`} className={button} disabled={study.busy} onClick={() => { if (confirm(`Delete the plan for ${exam.subject}?`)) void study.save((value) => ({ ...value, exams: value.exams.filter((item) => item.id !== exam.id) })); }}><Trash2Icon className="size-4" /></button></div>
			</div>{calendarNotice?.examId === exam.id && <p role={calendarNotice.error ? "alert" : "status"} className={`px-5 pt-3 text-sm ${calendarNotice.error ? "text-red-300" : "text-muted-foreground"}`}>{calendarNotice.text}</p>}<div className="divide-y divide-border/50">{exam.events.map((event) => <div key={event.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
				<input type="checkbox" aria-label={`Mark ${event.title} complete`} checked={event.completed ?? false} disabled={study.busy} onChange={(change) => void study.save((value) => ({ ...value, exams: value.exams.map((item) => item.id === exam.id ? { ...item, events: item.events.map((block) => block.id === event.id ? { ...block, completed: change.target.checked } : block) } : item) }))} className="size-4 accent-blue-500" />
				<div className="min-w-0 flex-1"><p className={`text-sm font-medium ${event.completed ? "text-muted-foreground line-through" : ""}`}>{event.title}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(event.start).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} – {new Date(event.end).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</p></div>
				<a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer" className="text-sm text-blue-300 hover:underline">Add to Google Calendar ↗</a>
				<button type="button" aria-label={`Remove ${event.title} block`} className="rounded p-1 text-muted-foreground hover:text-red-300" disabled={study.busy} onClick={() => { if (confirm("Remove this study block?")) void study.save((value) => ({ ...value, exams: value.exams.map((item) => item.id === exam.id ? { ...item, events: item.events.filter((block) => block.id !== event.id) } : item) })); }}><Trash2Icon className="size-4" /></button>
			</div>)}</div></Panel>)}
			<p className="text-xs leading-5 text-muted-foreground">The planner avoids other Learnins blocks, but does not check existing Google Calendar events. Google links open individual events for review. Adding a plan is a one-time copy; later Learnins changes do not update Calendar. The .ics file contains every block.</p>
		</div>
	</div>;
}

function Materials({ study }: { study: StudyController }) {
	const router = useRouter();
	const input = useRef<HTMLInputElement>(null);
	const [importing, setImporting] = useState(false);
	const [notice, setNotice] = useState("");
	const [expanded, setExpanded] = useState("");
	const [query, setQuery] = useState("");
	const filtered = study.data!.materials.filter((item) => `${item.name}\n${item.text}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
	async function upload(files: FileList | null) {
		if (!files?.length || importing) return;
		setImporting(true); setNotice(""); study.setError("");
		try {
			for (const file of Array.from(files)) {
				const result = await study.updateMaterial("POST", file);
				if (!result) return;
				setExpanded(result.materials.at(-1)?.id ?? "");
			}
			setNotice("Original files and extracted text are stored locally.");
		} catch (err) { study.setError(err instanceof Error ? err.message : "Import failed."); }
		finally { setImporting(false); if (input.current) input.current.value = ""; }
	}
	async function addToGraph(material: StudyMaterial) {
		setNotice("");
		try {
			const [result] = await postNotesImport([new File([material.text], material.name + ".txt", { type: "text/plain" })]);
			setNotice(result?.ok ? `Added ${result.stats?.nodes ?? 0} propositions from ${material.name} to the knowledge graph.` : `${material.name}: ${result?.error ?? "Import failed."}`);
		} catch (err) { study.setError(err instanceof Error ? err.message : "Graph import failed."); }
	}
	async function startWith(material: StudyMaterial) {
		try {
			let source = "";
			if (material.originalExtension) {
				const response = await fetch(`/api/study/materials?id=${encodeURIComponent(material.id)}`);
				const paths = await response.json();
				if (!response.ok) throw new Error(paths.error || "The original file is unavailable.");
				source = `\nOriginal file: ${paths.original}\nExtracted text: ${paths.extracted}\nUse the PDF reader for PDFs or the read tool for text and images as needed.`;
			} else {
				const excerpt = material.text.slice(0, 40_000);
				source = `\n\n${excerpt}${material.text.length > excerpt.length ? "\n\n[Material excerpt truncated at 40,000 characters.]" : ""}`;
			}
			sessionStorage.setItem("learnins:starter", `Help me learn from this material: ${material.name}${source}`);
			router.push("/chat/new");
		} catch (err) { study.setError(err instanceof Error ? err.message : "Could not open this material."); }
	}
	return <div className="space-y-6">
		<div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files); }}>
		<Panel className="flex flex-wrap items-center justify-between gap-5 p-6"><div><h2 className="font-semibold">Add learning material</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Drop or upload PDF, Word, PowerPoint, images, notes, code, or exported Teams VTT/SRT transcripts.</p></div>
			<input ref={input} type="file" multiple className="sr-only" accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.txt,.md,.markdown,.csv,.tsv,.vtt,.srt,.json,.js,.ts,.py" onChange={(e) => void upload(e.target.files)} />
			<button type="button" className={primary} disabled={importing || study.busy} onClick={() => input.current?.click()}><UploadIcon className="size-4" />{importing ? "Importing…" : "Choose files"}</button>
		</Panel>
		</div>
		{notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
		<div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Library <span className="ml-1 text-sm font-normal text-muted-foreground">{study.data!.materials.length} {study.data!.materials.length === 1 ? "file" : "files"}</span></h2><input type="search" aria-label="Search materials" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search materials…" className={`max-w-64 ${field}`} /></div>
		{!study.data!.materials.length ? <Panel className="px-6 py-12 text-center"><FileTextIcon className="mx-auto mb-4 size-7 text-blue-400" /><h3 className="font-semibold">Your library is empty</h3><p className="mt-2 text-sm text-muted-foreground">Add a file to read it, study with it or add it to your knowledge graph.</p></Panel> :
			filtered.length === 0 ? <p className="text-sm text-muted-foreground">No materials match “{query}”.</p> :
			<div className="space-y-3">{filtered.map((material) => <Panel key={material.id} className="overflow-hidden"><div className="flex flex-wrap items-center gap-3 p-4"><FileTextIcon className="size-5 shrink-0 text-blue-400" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{material.name}</p><p className="mt-1 text-xs text-muted-foreground">{material.text.length.toLocaleString()} characters · added {new Date(material.createdAt).toLocaleDateString()}</p></div>
				<button type="button" className={button} onClick={() => setExpanded(expanded === material.id ? "" : material.id)}>{expanded === material.id ? "Hide text" : "View text"}</button>
				<button type="button" className={button} onClick={() => void startWith(material)}>Study with this</button>
				<button type="button" className={button} disabled={!material.text.trim()} onClick={() => void addToGraph(material)}>Add to graph</button>
				<button type="button" aria-label={`Delete ${material.name}`} className={button} disabled={study.busy} onClick={() => { if (confirm(`Delete ${material.name} from your library?`)) void study.updateMaterial("DELETE", material.id); }}><Trash2Icon className="size-4" /></button>
			</div>{expanded === material.id && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-border px-5 py-4 font-prose text-sm leading-6 text-muted-foreground">{material.text || "No text was extracted. The original file is available to the tutor."}</pre>}</Panel>)}</div>}
	</div>;
}
