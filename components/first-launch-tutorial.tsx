"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpenIcon, FileTextIcon, KeyRoundIcon, Layers3Icon, MessageCircleIcon, NetworkIcon, SparklesIcon } from "lucide-react";

const steps = [
	{
		title: "Welcome to Learnins",
		description: "Turn a question or your course materials into a learning session, and build on what you learn over time.",
		items: [
			{ icon: MessageCircleIcon, title: "Start with a question", detail: "Tell your tutor what you want to understand." },
			{ icon: BookOpenIcon, title: "Learn at your own pace", detail: "Return to sessions and practise when you are ready." },
		],
	},
	{
		title: "Connect your AI provider",
		description: "Learnins needs a model connection to teach, practise, and build your knowledge graph.",
		items: [
			{ icon: KeyRoundIcon, title: "Choose how to connect", detail: "Use an API key or a supported subscription, including Local Codex." },
			{ icon: SparklesIcon, title: "Select your models", detail: "Choose the models used for teaching and other tasks in the setup flow." },
		],
	},
	{
		title: "Start a learning session",
		description: "Enter a topic on Home, choose Teaching or Practice, and start a session. Your tutor will guide you from there.",
		items: [
			{ icon: FileTextIcon, title: "Bring your own materials", detail: "Add notes, PDFs or exported Teams transcripts in Materials." },
			{ icon: BookOpenIcon, title: "Study with a file", detail: "Choose “Study with this” in your library to start with that material." },
		],
	},
	{
		title: "Keep your learning moving",
		description: "Your sessions and study tools are available from the sidebar whenever you need them.",
		items: [
			{ icon: NetworkIcon, title: "See what you know", detail: "The knowledge graph keeps track of concepts from your learning." },
			{ icon: Layers3Icon, title: "Practise and plan", detail: "Review flashcards, prepare for exams in Planner, or try code in Coding." },
		],
	},
] as const;

export function FirstLaunchTutorial({ configured, onClose }: { configured: boolean; onClose: (connect: boolean) => void }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const next = useRef<HTMLButtonElement>(null);
	const [step, setStep] = useState(0);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const current = steps[step]!;

	useEffect(() => {
		const element = dialog.current;
		if (!element) return;
		element.showModal();
		next.current?.focus();
		return () => { if (element.open) element.close(); };
	}, []);

	async function finish(connect = false) {
		if (saving) return;
		setSaving(true);
		setError("");
		try {
			const response = await fetch("/api/tutorial", { method: "POST" });
			if (!response.ok) throw new Error("Could not save your tutorial preference. Please try again.");
			onClose(connect);
		} catch {
			setError("Could not save your tutorial preference. Please try again.");
			setSaving(false);
		}
	}

	return <dialog ref={dialog} aria-labelledby="tutorial-title" aria-describedby="tutorial-description"
		onCancel={(event) => { event.preventDefault(); void finish(); }}
		className="learnins-tutorial m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl">
		<div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-7">
			<div className="flex items-center gap-2 text-sm font-semibold"><BookOpenIcon className="size-4 text-blue-400" aria-hidden="true" />Learnins</div>
			<button type="button" onClick={() => void finish()} disabled={saving} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">Skip tutorial</button>
		</div>
		<div className="px-5 py-7 sm:px-7 sm:py-8">
			<div className="mb-6 flex items-center gap-2" aria-label={`Step ${step + 1} of ${steps.length}`}>
				{steps.map((item, index) => <span key={item.title} className={`h-1 flex-1 rounded-full ${index <= step ? "bg-blue-500" : "bg-border"}`} />)}
				<span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">{step + 1} / {steps.length}</span>
			</div>
			<div aria-live="polite">
				<h2 id="tutorial-title" className="text-2xl font-semibold tracking-tight">{current.title}</h2>
				<p id="tutorial-description" className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{current.description}</p>
				<ul className="mt-7 space-y-5 border-t border-border pt-6">
					{current.items.map(({ icon: Icon, title, detail }) => <li key={title} className="flex gap-4">
						<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground"><Icon className="size-4" aria-hidden="true" /></span>
						<div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p></div>
					</li>)}
				</ul>
			</div>
			{error && <p role="alert" className="mt-5 text-sm text-red-300">{error}</p>}
		</div>
		<div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-7">
			<button type="button" onClick={() => setStep((value) => value - 1)} disabled={step === 0 || saving} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:invisible">Back</button>
			<button ref={next} type="button" disabled={saving} onClick={() => step < steps.length - 1 ? setStep((value) => value + 1) : void finish(!configured)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
				{saving ? "Saving…" : step < steps.length - 1 ? "Next" : configured ? "Start learning" : "Connect a provider"}
			</button>
		</div>
	</dialog>;
}
