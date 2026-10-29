"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, BookOpenIcon, CalendarDaysIcon, Code2Icon, FileTextIcon, HelpCircleIcon, Layers3Icon, PlusIcon } from "lucide-react";
import { SidebarToggle } from "@/components/sidebar";
import { SetupDialog } from "@/components/setup-dialog";
import { useModelSetup } from "@/components/setup-cta";
import { FirstLaunchTutorial } from "@/components/first-launch-tutorial";
import type { ChatListItem, StudyData } from "@/src/core";

export function Dashboard({ initialConfigured, initialTutorialCompleted = false }: { initialConfigured: boolean; initialTutorialCompleted?: boolean }) {
	const router = useRouter();
	const { configured } = useModelSetup(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);
	const [tutorialOpen, setTutorialOpen] = useState(!initialTutorialCompleted);
	const [topic, setTopic] = useState("");
	const [mode, setMode] = useState<"teach" | "practice">("teach");
	const [study, setStudy] = useState<StudyData | null>(null);
	const [sessions, setSessions] = useState<ChatListItem[] | null>(null);
	const [sessionError, setSessionError] = useState(false);
	useEffect(() => {
		void fetch("/api/study").then((response) => response.ok ? response.json() : null).then(setStudy).catch(() => {});
		void fetch("/api/chats").then((response) => { if (!response.ok) throw new Error("Sessions unavailable"); return response.json(); }).then((body) => setSessions(body.chats ?? [])).catch(() => setSessionError(true));
	}, []);
	const due = study?.decks.flatMap((deck) => deck.cards).filter((card) => Date.parse(card.dueAt) <= Date.now()).length;
	const today = new Date();
	const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
	const nextExam = study?.exams.filter((exam) => exam.date >= dateKey).sort((a, b) => a.date.localeCompare(b.date))[0];
	const tools = [
		{ href: "/study/materials", icon: FileTextIcon, name: "Materials", detail: study ? `${study.materials.length} in your library` : "Your notes and files" },
		{ href: "/study/flashcards", icon: Layers3Icon, name: "Flashcards", detail: due === undefined ? "Practise and remember" : `${due} ${due === 1 ? "card" : "cards"} due` },
		{ href: "/study/planner", icon: CalendarDaysIcon, name: "Planner", detail: nextExam ? `${nextExam.subject} · ${nextExam.date}` : "Plan your next exam" },
		{ href: "/study/coding", icon: Code2Icon, name: "Coding", detail: "Write, run and review code" },
	];
	function start() {
		const draft = topic.trim();
		if (draft) sessionStorage.setItem("learnins:starter", draft);
		router.push(mode === "practice" ? "/chat/new?mode=practice" : "/chat/new");
	}
	return <div data-native-tab className="flex h-dvh min-w-0 flex-col bg-background">
		<header className="lh-drag lh-wco-gutter flex h-14 shrink-0 items-center gap-3 border-b border-border px-4"><SidebarToggle /><span className="text-sm font-medium">Home</span></header>
		<main className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
			<div className="mb-8 flex flex-wrap items-start justify-between gap-5">
				<div><h1 className="text-2xl font-semibold tracking-tight">What would you like to learn?</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Start with a question, a topic, or something you want to practise.</p></div>
				<div className="flex flex-wrap items-center gap-2">
					<button type="button" onClick={() => setTutorialOpen(true)} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><HelpCircleIcon className="size-4" />Tutorial</button>
					{!configured && <button type="button" onClick={() => setSetupOpen(true)} className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-accent">Connect a provider</button>}
				</div>
			</div>
			<form onSubmit={(event) => { event.preventDefault(); start(); }} className="rounded-lg border border-border bg-card p-4">
				<label htmlFor="dashboard-topic" className="sr-only">What do you want to learn?</label>
				<textarea id="dashboard-topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="For example: help me understand how recursion works" className="min-h-24 w-full resize-y bg-transparent px-1 py-1 text-base leading-6 outline-none placeholder:text-muted-foreground" />
				<div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
					<div className="flex gap-1 rounded-md bg-background p-1">
						{(["teach", "practice"] as const).map((item) => <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)} className={`rounded px-3 py-1.5 text-sm ${mode === item ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{item === "teach" ? "Teaching" : "Practice"}</button>)}
					</div>
					<button type="submit" className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">Start a session <ArrowRightIcon className="size-4" /></button>
				</div>
			</form>
			<div className="mt-9 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
				<section className="min-w-0"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Recent sessions</h2><p className="mt-1 text-sm text-muted-foreground">Pick up where you left off.</p></div><Link href="/chat/new" className="inline-flex shrink-0 items-center gap-1.5 text-sm text-blue-300 hover:underline"><PlusIcon className="size-4" />New session</Link></div>
					<div className="overflow-hidden rounded-lg border border-border bg-card">
						{sessionError ? <p role="alert" className="px-5 py-8 text-sm text-red-300">Sessions could not be loaded. Refresh to try again.</p> : sessions === null ? <p className="px-5 py-8 text-sm text-muted-foreground">Loading sessions…</p> : sessions.length === 0 ? <div className="px-5 py-8"><BookOpenIcon className="mb-3 size-5 text-blue-400" /><p className="text-sm font-medium">Your learning starts here</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Your teaching and practice sessions will appear here.</p></div> :
							sessions.slice(0, 6).map((session) => <Link key={session.id} href={`/chat/${session.id}`} className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-0 hover:bg-accent"><BookOpenIcon className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title || "Untitled session"}</span><ArrowRightIcon className="size-4 text-muted-foreground" /></Link>)}
					</div>
				</section>
				<section className="min-w-0"><div className="mb-4"><h2 className="font-semibold">Study tools</h2><p className="mt-1 text-sm text-muted-foreground">Make your learning go further.</p></div>
					<div className="overflow-hidden rounded-lg border border-border bg-card">{tools.map(({ href, icon: Icon, name, detail }) => <Link key={href} href={href} className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-0 hover:bg-accent"><Icon className="size-4 shrink-0 text-blue-400" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{detail}</span></span><ArrowRightIcon className="size-4 text-muted-foreground" /></Link>)}</div>
					<Link href="/graph" className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><BookOpenIcon className="size-4" />Open knowledge graph <ArrowRightIcon className="size-4" /></Link>
				</section>
			</div>
		</div></main>
		<SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} onDone={() => setSetupOpen(false)} />
		{tutorialOpen && <FirstLaunchTutorial configured={configured} onClose={(connect) => { setTutorialOpen(false); if (connect) setSetupOpen(true); }} />}
	</div>;
}
