"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, FolderIcon } from "lucide-react";
import { MenuShell } from "@/components/menu-shell";

export function ProjectPicker({ projects, value, onChange, disabled = false }: {
	projects: { id: string; name: string }[];
	value: string;
	onChange: (id: string) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const label = projects.find((project) => project.id === value)?.name ?? "No project";
	useEffect(() => {
		if (!open) return;
		const dismiss = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && (trigger.current?.contains(target) || target.closest('[data-testid="project-picker-menu"]'))) return;
			setOpen(false);
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
		};
		document.addEventListener("pointerdown", dismiss);
		document.addEventListener("keydown", escape, true);
		return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape, true); };
	}, [open]);
	return <div className="pointer-events-auto min-w-0">
		<button ref={trigger} type="button" aria-label={`Project: ${label}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-50">
			<FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="text-muted-foreground">Project</span><span className="max-w-44 truncate font-medium">{label}</span><ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		</button>
		{open && !disabled && <MenuShell anchorRef={trigger} testid="project-picker-menu" preferredSide="up" align="left" menuClass="w-64 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-card p-1.5 text-sm shadow-xl">
			<div role="menu" aria-label="Choose project">{[{ id: "", name: "No project" }, ...projects].map((project) => <button key={project.id} type="button" role="menuitemradio" aria-checked={value === project.id} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" onClick={() => { onChange(project.id); setOpen(false); trigger.current?.focus(); }}><span className="min-w-0 flex-1 truncate">{project.name}</span>{value === project.id && <CheckIcon className="size-4 shrink-0 text-blue-400" aria-hidden="true" />}</button>)}</div>
		</MenuShell>}
	</div>;
}
