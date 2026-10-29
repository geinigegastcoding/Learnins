"use client";
/**
 * The first-run setup flow (model-slots wave, 2026-09-20, owner design
 * "A — composer CTA + send interception"): chats cannot start until the
 * user has picked all three model slots — there are no defaults for 33
 * providers. The graph view's new-session dock (the app's home, where
 * chats start) shows a "Set up your models" CTA while unconfigured;
 * submitting a topic — or sending on /chat/new — opens THIS dialog with
 * the draft preserved; Save stores the slots — the draft WAITS in the
 * composer, the learner sends it themselves (owner ruling 2026-10-09:
 * saving models must never send the message).
 *
 * STAGED BY DEPENDENCY (owner, 2026-09-20: "first keys, then models —
 * there's no point presenting the model picker before the user has set a
 * key because there are no models to pick then"):
 *   Unknown catalog — neutral loading (or error/Retry), never a key screen.
 *   Stage 1 — no keyed provider or saved selection: a SELF-CONTAINED first-key screen
 *     (zero-keys wave, owner 2026-09-25): provider picker + one key
 *     input + save via PUT /api/keys/:id. The dialog STAYS MOUNTED —
 *     saving dispatches the "keys" signal, the fetch effect re-runs on
 *     it, and the stage flips to the pickers on its own. No Settings
 *     round-trip anymore; the draft lives in the caller's state,
 *     untouched throughout.
 *   Stage 2 — Strong → Cheap → Vision pickers over the FEDERATED catalog
 *     (keyed providers only), the vision slot filtered to image-capable
 *     models, in the app's shared dropdown language (ModelMenuList).
 *     Saved disconnected selections and edits are retained internally in
 *     the exclusive provider stage. Connecting with all slots already saved
 *     closes setup; otherwise the pickers require only the missing slots.
 *     All three required (owner: no skip, no defaults); Save PUTs the
 *     models section and reports onDone(models).
 *
 * Closable without configuring (Esc/backdrop/✕) — browsing the app stays
 * possible; the GATE is the send interception, not the dialog. The
 * settings-dialog visual language: dim backdrop, border rounded-md card,
 * CMU title, z-50.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import type React from "react";
import { type ModelCatalogEntry, type ModelSlotName, type ModelsSettings } from "@/src/core";
import { prettyModel } from "@/components/usage-format";
import { ModelMenuList } from "@/components/settings/model-menu";
import { MenuShell } from "@/components/menu-shell";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { useModelCatalog } from "@/components/model-catalog";
import { savedSlotsConfigured } from "@/components/setup-cta";
import { Hint } from "@/components/ui/hint";
import { type ProviderKeyInfo } from "@/components/settings/keys-section";
import { ProviderMenuList } from "@/components/settings/model-menu";
import { ChatGPTBackgroundAccess } from "@/components/settings/chatgpt-connection";
import { NativeSubscriptionBackgroundAccess, SubscriptionConnections } from "@/components/settings/subscription-connections";
import { defaultOrderLevel, populateLevel, THINKING_LABEL } from "@/components/thinking-default";
import { ThinkingMenuList } from "@/components/settings/model-menu";
import { ProviderMark } from "@/components/provider-mark";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/** The pickers' slot identity — same roster language as the Agent
 *  section's slot rows. */
const SLOT_META: Record<ModelSlotName, { label: string; roster: string }> = {
	strong: { label: "Strong", roster: "Lessons and practice" },
	cheap: { label: "Cheap", roster: "Research, graph updates and other background work" },
	vision: { label: "Vision", roster: "Understanding images and PDFs" },
};
const SLOT_ORDER: readonly ModelSlotName[] = ["strong", "cheap", "vision"];

/** The GET /api/models response fields the flow consumes. */
interface ModelsBody {
	models: ModelCatalogEntry[];
	providers: { id: string; keyPresent: boolean }[];
	/** The three tiers' RESOLVED pins (BYOK: NULL per unset tier) — the
	 *  PREFILL + "needed" marks (owner, 2026-09-22): pinned tiers open
	 *  with their pick, unpinned tiers carry the mark. */
	slots?: Record<ModelSlotName, { model: { provider: string; id: string }; thinkingLevel?: ThinkingLevel } | null>;
}

/** Pure: which stage the flow opens at — no keyed provider = keys first
 *  (owner's dependency ordering). Exported for tests. */
export function setupStage(
	providers: { id: string; keyPresent: boolean }[] | null,
): "loading" | "keys" | "pickers" {
	if (providers === null) return "loading";
	return providers.some((p) => p.keyPresent) ? "pickers" : "keys";
}

type ModelSelection = Pick<ModelCatalogEntry, "provider" | "id">;

/** Saved identity is independent of selectable metadata. A disconnected
 * pin still prefills; only the menu is restricted to the live catalog. */
export function prefillFromSlots(
	models: ModelCatalogEntry[],
	slots: Record<ModelSlotName, { model: { provider: string; id: string } } | null> | undefined,
): Partial<Record<ModelSlotName, ModelSelection>> {
	const pre: Partial<Record<ModelSlotName, ModelSelection>> = {};
	for (const slot of SLOT_ORDER) {
		const pin = slots?.[slot];
		const entry = pin?.model
			? models.find((m) => m.provider === pin.model!.provider && m.id === pin.model!.id)
			: undefined;
		if (pin?.model) pre[slot] = entry ?? pin.model;
	}
	return pre;
}

/** Level prefill (chunk 2): a pinned tier opens with its STORED level
 *  as-is (Save clamps server-side if the ladder lapsed), else the
 *  ordering's level for that model — the level a fresh pick would
 *  populate (owner: the ordering's only purpose is first assignment).
 *  Exported pure for tests. */
export function prefillLevelFromPin(
	entry: ModelCatalogEntry,
	pin: { thinkingLevel?: ThinkingLevel } | null | undefined,
): ThinkingLevel {
	return populateLevel(pin?.thinkingLevel, entry.supportedLevels);
}

/** Stage 1's pure body — exported for SSR pins (the delete/settings
 *  body pattern). The wrapper owns state + effects + the portal.
 *
 * The first-key screen (owner, zero-keys wave): provider picker (the
 * app's shared dropdown language, ProviderMenuList), one paste input,
 * Save. A save that 400s keeps the line inline (the keys section's
 * shape-gates write user-facing error text). */
export function SetupKeysBody({
	providers,
	provider,
	mode = "api",
	credentials = false,
	value,
	saving,
	error,
	menuOpen,
	onToggleMenu,
	onPick,
	onModeChange,
	onValue,
	onSave,
	menuAnchor,
}: {
	/** The full provider roster (GET /api/keys providers) — undefined
	 *  while it loads; the picker renders an honest empty state then. */
	providers: ProviderKeyInfo[] | undefined;
	/** The chosen provider; null = the picker trigger reads "Pick a
	 *  provider…". */
	provider: ProviderKeyInfo | null;
	mode?: "api" | "subscription";
	credentials?: boolean;
	value: string;
	saving: boolean;
	error: string | null;
	menuOpen: boolean;
	onToggleMenu: () => void;
	onPick: (p: ProviderKeyInfo) => void;
	onModeChange?: (mode: "api" | "subscription") => void;
	onValue: (v: string) => void;
	onSave: () => void;
	/** The MenuShell anchor — wired by the wrapper (its triggerRef). */
	menuAnchor: React.RefObject<HTMLDivElement | null>;
}) {
	return (
		<div className="flex flex-col gap-5 px-6 py-5" data-testid="setup-stage-keys">
			{!credentials && <>
				<p className="text-sm leading-6 text-muted-foreground">Choose how you want to connect. You’ll pick your learning models next.</p>
				<div className="flex w-fit gap-1 rounded-lg bg-background p-1" role="group" aria-label="Connection method">
					{(["api", "subscription"] as const).map((item) => <button key={item} type="button" aria-pressed={mode === item} onClick={() => onModeChange?.(item)} className={`rounded-md px-3 py-2 text-sm ${mode === item ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{item === "api" ? "API key" : "Subscription"}</button>)}
				</div>
			</>}
			{mode === "subscription" ? <div className="space-y-4">
				<div><h3 className="text-sm font-semibold">Sign in with a subscription</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Choose an account to connect, if your plan supports it.</p></div>
				<SubscriptionConnections setup />
			</div> : credentials && provider ? <div className="space-y-4">
				<div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
					<ProviderMark provider={provider.id} className="size-5 text-foreground" />
					<div><h3 className="text-sm font-semibold">{provider.label}</h3><p className="mt-0.5 text-xs text-muted-foreground">API key connection</p></div>
				</div>
				<div><label htmlFor="setup-api-key" className="mb-2 block text-sm font-medium">API key</label>
					<input id="setup-api-key" type="password" autoComplete="off" value={value} onChange={(e) => onValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onSave(); }} placeholder="Paste your key" aria-label={`${provider.label} key`} data-testid="setup-key-input" disabled={saving} autoFocus className="h-11 w-full rounded-md border border-border bg-background px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400" />
					<p className="mt-2 text-xs leading-5 text-muted-foreground">Saved locally. The key is checked for format; your provider verifies it when you start a session.</p>
				</div>
				{error && <p role="alert" data-testid="setup-key-error" className="text-sm text-red-400">{error}</p>}
			</div> : <>
			<h3 className="text-sm font-semibold">Provider</h3>
			<div className="grid grid-cols-2 gap-2" aria-label="Popular providers">
				{["openai", "anthropic", "google", "openrouter", "opencode", "xai"].map((id) => providers?.find((item) => item.id === id)).filter((item): item is ProviderKeyInfo => !!item).map((item) => (
					<button key={item.id} type="button" data-testid={`setup-provider-${item.id}`} onClick={() => onPick(item)} aria-pressed={provider?.id === item.id}
						className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors ${provider?.id === item.id ? "border-blue-500 bg-blue-500/10 text-foreground" : "border-border bg-background text-foreground hover:bg-accent"}`}>
						<ProviderMark provider={item.id} className="size-5 text-foreground text-[10px] font-semibold" />
						<span className="truncate font-medium">{item.label}</span>
						{provider?.id === item.id && <span aria-hidden="true" className="ml-auto text-blue-400">✓</span>}
					</button>
				))}
			</div>
			<div ref={menuAnchor} className="relative">
					<button
						type="button"
						aria-label="Provider"
						data-testid="setup-key-provider"
						aria-expanded={menuOpen}
						onClick={onToggleMenu}
						className="flex min-h-10 w-full items-center gap-2 rounded-md border border-border bg-background px-3 font-ui text-sm text-foreground transition-colors hover:border-muted-foreground/50"
					>
						<span className="min-w-0 flex-1 truncate text-left">{provider ? provider.label : "Browse all providers…"}</span>
						<span aria-hidden className="text-muted-foreground">
							▾
						</span>
					</button>
					{menuOpen && (
						<MenuShell
							anchorRef={menuAnchor}
							testid="setup-key-provider-menu"
							preferredSide="down"
							align="left"
							menuClass="flex w-[22rem] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
						>
							<ProviderMenuList providers={providers ?? []} onPick={onPick} />
						</MenuShell>
					)}
				</div>
			</>}
		</div>
	);
}

function prefillLevels(body: ModelsBody | undefined): Partial<Record<ModelSlotName, ThinkingLevel>> {
	const levels: Partial<Record<ModelSlotName, ThinkingLevel>> = {};
	for (const slot of SLOT_ORDER) {
		const pin = body?.slots?.[slot];
		const entry = body?.models.find((m) => m.provider === pin?.model.provider && m.id === pin.model.id);
		if (pin?.thinkingLevel !== undefined) levels[slot] = pin.thinkingLevel;
		else if (entry) levels[slot] = prefillLevelFromPin(entry, pin);
	}
	return levels;
}

interface SetupDialogProps {
	open: boolean;
	onClose: () => void;
	/** Saving never sends the caller's draft. */
	onDone: (models: ModelsSettings) => void;
}

export function SetupDialog(props: SetupDialogProps) {
	// An open owns its draft. Mount-time cache seeding avoids a key-screen
	// first frame, and reopening cannot reuse a previous open's edits.
	return props.open ? <OpenSetupDialog {...props} /> : null;
}

function OpenSetupDialog({ onClose, onDone }: SetupDialogProps) {
	const backdropDismiss = useBackdropDismiss(onClose);
	const dialogRef = useRef<HTMLDivElement>(null);
	const { catalog, failed, refresh } = useModelCatalog();
	const providerStageSeen = useRef(false);
	const connectionCloseRequested = useRef(false);
	const [picked, setPicked] = useState(() => prefillFromSlots(catalog?.models ?? [], catalog?.slots));
	const [levels, setLevels] = useState(() => prefillLevels(catalog));
	const editedSlots = useRef(new Set<ModelSlotName>());
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [openMenu, setOpenMenu] = useState<{ slot: ModelSlotName; kind: "model" | "thinking" } | null>(null);
	// Stage 1's first-key screen (zero-keys wave): the provider roster,
	// the chosen provider + pasted value, its busy/error pair, and its own
	// menu-open bit (the slot menus' dismissal machinery covers it too —
	// see the trigger testid branch below).
	const [keyProviders, setKeyProviders] = useState<ProviderKeyInfo[] | undefined>(undefined);
	const [keyProvider, setKeyProvider] = useState<ProviderKeyInfo | null>(null);
	const [connectionMode, setConnectionMode] = useState<"api" | "subscription">("api");
	const [credentialStep, setCredentialStep] = useState(false);
	const [keyValue, setKeyValue] = useState("");
	const [keySaving, setKeySaving] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(null);
	const [keyMenuOpen, setKeyMenuOpen] = useState(false);
	// Stage 1's provider-picker trigger wrapper — the shared shell's anchor.
	// Stage 2's slot menus anchor by anchorTestid instead — see the slot
	// MenuShell below for why a freshly attached ref cannot work there.
	const keyTriggerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		dialogRef.current?.focus();
		return () => { if (previous?.isConnected) previous.focus(); };
	}, []);

	// The keys signal (zero-keys wave): keys-section saves/deletes AND
	// THIS dialog's own first-key save dispatch it; the fetch effect below
	// re-runs on it, so saving a key widens the catalog. Incomplete saved
	// slots advance to pickers; complete saved slots just close setup.
	const [keysTick, setKeysTick] = useState(0);
	useSettingsSaved((section) => {
		if (section === "keys") setKeysTick((t) => t + 1);
	});

	useEffect(() => {
		let cancelled = false;
		fetch("/api/keys")
			.then((r) => r.json())
			.then((b: { providers?: ProviderKeyInfo[] }) => { if (!cancelled) setKeyProviders(b.providers ?? []); })
			.catch(() => { if (!cancelled) setKeyProviders([]); });
		return () => { cancelled = true; };
	}, [keysTick]);

	useEffect(() => {
		if (!catalog) return;
		const pre = prefillFromSlots(catalog.models, catalog.slots);
		const preLevels = prefillLevels(catalog);
		// Fresh metadata is always used, but a response cannot reset an
		// edited slot, including a level chosen while the request was pending.
		setPicked((prev) => {
			const next = { ...prev };
			for (const slot of SLOT_ORDER) if (!editedSlots.current.has(slot)) {
				if (pre[slot]) next[slot] = pre[slot]; else delete next[slot];
			}
			return next;
		});
		setLevels((prev) => {
			const next = { ...prev };
			for (const slot of SLOT_ORDER) if (!editedSlots.current.has(slot)) {
				if (preLevels[slot] !== undefined) next[slot] = preLevels[slot]; else delete next[slot];
			}
			return next;
		});
	}, [catalog]);

	const stage = setupStage(catalog?.providers ?? null);
	const closeAfterConnection = stage === "pickers" && providerStageSeen.current && savedSlotsConfigured(catalog?.slots);
	useEffect(() => {
		if (stage === "keys") providerStageSeen.current = true;
		if (closeAfterConnection && !connectionCloseRequested.current) {
			connectionCloseRequested.current = true;
			onClose(); // Connection recovery is not a model-settings save.
		}
	}, [stage, closeAfterConnection, onClose]);

	// Esc + outside-click — layered dismissal, closable WITHOUT
	// configuring (browsing stays possible; the gate is the send
	// interception, not this dialog). An open slot menu eats Esc first
	// (and any click outside it); only a bare Esc closes the dialog.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// THE ONE-ESC LAW (owner, keyboard round 2026-10-06): claim at
			// the document level before the layered dismissal — every branch
			// below acts, so the window chain (dictation → abort) must
			// never also fire. One Esc, one action.
			e.preventDefault();
			e.stopPropagation();
			if (keyMenuOpen) {
				setKeyMenuOpen(false);
				return;
			}
			if (openMenu !== null) setOpenMenu(null);
			else onClose();
		};
		const onPointerDown = (e: PointerEvent) => {
			if (!(e.target instanceof Element)) return;
			const t = e.target;
			if (keyMenuOpen) {
				if (t.closest("[data-lh-menu]") || t.closest('[data-testid="setup-key-provider"]')) return;
				setKeyMenuOpen(false);
			}
			if (openMenu === null) return;
			const triggerTestid =
				openMenu.kind === "model" ? `setup-trigger-${openMenu.slot}` : `setup-thinking-${openMenu.slot}`;
			if (t.closest("[data-lh-menu]") || t.closest(`[data-testid="${triggerTestid}"]`)) return;
			setOpenMenu(null);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [onClose, openMenu, keyMenuOpen]);

	// Do not briefly paint model pickers between successful connection and
	// closing an already-configured setup. No saved model/thinking writes.
	if (closeAfterConnection) return null;

	const allPicked = SLOT_ORDER.every((s) => picked[s]);

	/** Stage 1's save: PUT the pasted key, dispatch the keys signal, and
	 *  CLEAN the local key field. The fresh catalog decides whether to
	 *  close recovery or advance to the missing model slots. Shape-gate
	 *  400s keep their user-facing line inline. */
	async function saveKey() {
		if (!keyProvider || !keyValue.trim() || keySaving) return;
		setKeySaving(true);
		setKeyError(null);
		const res = await fetch(`/api/keys/${encodeURIComponent(keyProvider.envVar)}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ value: keyValue }),
		}).catch(() => null);
		setKeySaving(false);
		if (!res || !res.ok) {
			const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
			setKeyError(res ? (body?.error ?? `Save failed (${res.status})`) : "Save failed. Check your connection and try again.");
			return;
		}
		setKeyProvider(null);
		setKeyValue("");
		notifySettingsSaved("keys");
	}

	async function save() {
		if (!allPicked || saving) return;
		setSaving(true);
		setError(null);
		const models: ModelsSettings = {};
		for (const slot of SLOT_ORDER) {
			const level = levels[slot];
			models[slot] = {
				model: { provider: picked[slot]!.provider, id: picked[slot]!.id },
				...(level ? { thinkingLevel: level } : {}),
			};
		}
		const res = await fetch("/api/settings/models", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(models),
		}).catch(() => null);
		if (!res || !res.ok) {
			setSaving(false);
			setError(res ? `Save failed: ${(await res.json().catch(() => ({}))).error ?? res.status}` : "Save failed. Check your connection and try again.");
			return;
		}
		notifySettingsSaved("models");
		onDone(models);
	}

	const keysBody = <SetupKeysBody
		providers={keyProviders}
		provider={keyProvider}
		mode={connectionMode}
		credentials={credentialStep}
		value={keyValue}
		saving={keySaving}
		error={keyError}
		menuOpen={keyMenuOpen}
		menuAnchor={keyTriggerRef}
		onToggleMenu={() => setKeyMenuOpen((v) => !v)}
		onPick={(p) => { if (p.id !== keyProvider?.id) setKeyValue(""); setKeyProvider(p); setKeyMenuOpen(false); setKeyError(null); }}
		onModeChange={(mode) => { setConnectionMode(mode); setKeyMenuOpen(false); setKeyValue(""); setKeyError(null); }}
		onValue={setKeyValue}
		onSave={() => void saveKey()}
	/>;

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-background/80"
			data-testid="setup-backdrop"
			{...backdropDismiss}
		>
			<div
				ref={dialogRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label="Set up your models"
				data-testid="setup-dialog"
				data-native-tab
				className="settings-dialog-pop flex max-h-[85vh] w-[640px] max-w-[90vw] flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl outline-none"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(event) => {
					if (event.key !== "Tab" || keyMenuOpen || openMenu) return;
					const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]') ?? [])];
					const first = items[0], last = items.at(-1);
					if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
					else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
				}}
			>
				<header className="flex h-15 shrink-0 items-center gap-3 border-b border-border px-5">
					<h2 className="font-title text-2xl tracking-tight">Set up your models</h2>
					<Hint label="Close" binding="escape" side="left">
<button
						type="button"
						aria-label="Close setup"
						data-testid="setup-close"
						onClick={onClose}
						className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
					>
						✕
					</button>
</Hint>
				</header>
				{stage !== "loading" && <div aria-label="Setup progress" className="mx-6 mt-4 grid grid-cols-2 gap-1 rounded-lg bg-background p-1 text-xs">
					<span aria-current={stage === "keys" ? "step" : undefined} className={`rounded-md px-3 py-2 ${stage === "keys" ? "bg-accent font-medium text-foreground" : "text-muted-foreground"}`}><span className="mr-2 text-blue-400">1</span>Provider</span>
					<span aria-current={stage === "pickers" ? "step" : undefined} className={`rounded-md px-3 py-2 ${stage === "pickers" ? "bg-accent font-medium text-foreground" : "text-muted-foreground"}`}><span className="mr-2 text-blue-400">2</span>Models</span>
				</div>}

				{failed && (
					<p role="alert" data-testid="setup-catalog-error" className="px-6 py-3 text-sm text-foreground">
						Model catalog could not be loaded. Check the connection and retry. <button type="button" data-testid="setup-retry" className="underline" onClick={refresh}>Retry</button>
					</p>
				)}
				{stage === "loading" ? (
					!failed && <p data-testid="setup-stage-loading" role="status" className="px-6 py-5 text-xs text-muted-foreground">Loading models…</p>
				) : stage === "keys" ? (
				<div className="min-h-0 overflow-y-auto">{keysBody}</div>
				) : (
					<div className="flex flex-col gap-4 overflow-y-auto px-6 py-5" data-testid="setup-stage-pickers">
						<p className="text-sm leading-6 text-muted-foreground">
							Pick the model for each tier. All three are required before chats can start.
						</p>
						{SLOT_ORDER.map((slot) => {
							const entry = picked[slot];
							const level = levels[slot];
							const metadata = catalog?.models.find((m) => m.id === entry?.id && m.provider === entry.provider);
							// Unavailable metadata cannot erase or clamp a saved preference.
							const levelsForEntry = metadata?.supportedLevels ?? (entry ? Object.keys(THINKING_LABEL) : []);
							const available = catalog?.models ?? (failed ? [] : undefined);
							const slotCatalog = slot === "vision" ? available?.filter((m) => m.input.includes("image")) : available;
							return (
								<div key={slot} data-testid={`setup-slot-${slot}`} className="flex flex-col gap-1.5">
									<span className="flex items-center gap-1.5">
										<span className="font-ui text-sm text-foreground">{SLOT_META[slot].label}</span>
										{!catalog?.slots?.[slot]?.model && !picked[slot] && (
											<span
												data-testid={`setup-needed-${slot}`}
												className="rounded-sm border border-border px-1 py-0.5 text-[10px] font-normal tracking-wide text-muted-foreground"
											>
												needed
											</span>
										)}
									</span>
									<span className="text-xs text-muted-foreground/70">{SLOT_META[slot].roster}</span>
									{slot !== "strong" && <><ChatGPTBackgroundAccess provider={entry?.provider} /><NativeSubscriptionBackgroundAccess provider={entry?.provider} /></>}
									<div className="flex items-center gap-2">
										<div className="relative flex-1">
											<Hint label={entry ? `${entry.provider}:${entry.id}` : "Pick a model…"}>
											<button
												type="button"
												aria-label={`${SLOT_META[slot].label} model`}
												data-testid={`setup-trigger-${slot}`}
												aria-expanded={openMenu?.slot === slot && openMenu.kind === "model"}
												onClick={() => setOpenMenu(openMenu?.slot === slot && openMenu.kind === "model" ? null : { slot, kind: "model" })}
												className="flex h-10 min-w-40 w-full items-center gap-2 rounded-md border border-border bg-background px-3 font-ui text-sm text-foreground transition-colors hover:border-muted-foreground/50"
											>
												<span className="min-w-0 flex-1 truncate">{entry ? prettyModel(entry.id) : "Pick a model…"}</span>
												<span aria-hidden className="text-muted-foreground">
													▾
												</span>
											</button>
											</Hint>
											{/* Anchor by TESTID, not a ref (the settings-section pattern):
											    React attaches a host element's ref AFTER its descendants'
											    layout effects run, so a ref freshly attached in this same
											    commit (menu opening = the ref condition turning true) is
											    still null when MenuShell measures — place() gives up, the
											    menu stays invisible, and only a window resize (which re-runs
											    place()) shows it. querySelector at place time has no such
											    ordering hazard. Live-caught by the owner 2026-10-09: every
											    setup picker opened dead until a window resize. */}
											{openMenu?.slot === slot && openMenu.kind === "model" && (
												<MenuShell
													anchorTestid={`setup-trigger-${slot}`}
													testid={`setup-menu-${slot}`}
													preferredSide="down"
													align="left"
													menuClass="flex w-[22rem] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
												>
													<ModelMenuList
														models={slotCatalog}
														effectiveId={entry?.id}
														effectiveProvider={entry?.provider}
														onPick={(m) => {
															editedSlots.current.add(slot);
															setPicked((prev) => ({ ...prev, [slot]: m }));
															// Auto-populate (chunk 2, owner: "populate
															// everywhere"): no explicit level → the
															// ordering's level for the fresh pick; an
															// explicit one rides (Save clamps server-side).
															setLevels((prev) => ({
																...prev,
																[slot]: populateLevel(prev[slot], m.supportedLevels),
															}));
															setOpenMenu(null);
														}}
														footer={slotCatalog && slotCatalog.length === 0 && slot === "vision" ? "No image-capable models. Add a provider key with access to a vision model." : undefined}
													/>
												</MenuShell>
											)}
										</div>
										{/* Thinking selector (chunk 2): editable, pre-populated from
										    the ordering per picked model — no model, no levels. */}
										<div className="relative">
											<button
												type="button"
												aria-label={`${SLOT_META[slot].label} thinking`}
												data-testid={`setup-thinking-${slot}`}
												aria-expanded={openMenu?.slot === slot && openMenu.kind === "thinking"}
												disabled={!entry}
												onClick={() => setOpenMenu(openMenu?.slot === slot && openMenu.kind === "thinking" ? null : { slot, kind: "thinking" })}
												className="flex h-10 w-28 items-center gap-2 rounded-md border border-border bg-background px-3 font-ui text-sm text-foreground transition-colors hover:border-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-40"
											>
												<span className="min-w-0 flex-1 truncate text-left">
													{entry ? (level ? THINKING_LABEL[level] ?? level : "…") : "—"}
												</span>
												<span aria-hidden className="text-muted-foreground">
													▾
												</span>
											</button>
											{openMenu?.slot === slot && openMenu.kind === "thinking" && (
												<MenuShell
													anchorTestid={`setup-thinking-${slot}`}
													testid={`setup-thinking-menu-${slot}`}
													preferredSide="down"
													align="left"
													menuClass="flex w-44 flex-col gap-0.5 rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
												>
													<ThinkingMenuList
														levels={levelsForEntry.map(String)}
														effectiveLevel={level}
														onPick={(lv) => {
															editedSlots.current.add(slot);
															setLevels((prev) => ({ ...prev, [slot]: lv as ThinkingLevel }));
															setOpenMenu(null);
														}}
													/>
												</MenuShell>
											)}
										</div>
									</div>
								</div>
							);
						})}
						{error && <p role="alert" className="text-sm text-red-400">{error}</p>}
					</div>
				)}
				{stage !== "loading" && <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
					<div>{stage === "keys" && credentialStep && <button type="button" disabled={keySaving} onClick={() => { setCredentialStep(false); setKeyError(null); }} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">Back</button>}</div>
					<div className="flex items-center gap-2">
						<button type="button" disabled={keySaving || saving} onClick={onClose} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">Cancel</button>
						{stage === "keys" && connectionMode === "api" && (credentialStep ?
							<button type="button" data-testid="setup-key-save" onClick={() => void saveKey()} disabled={keySaving || !keyValue.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40">{keySaving ? "Saving…" : "Save key"}</button> :
							<button type="button" data-testid="setup-provider-continue" onClick={() => setCredentialStep(true)} disabled={!keyProvider} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40">Continue</button>)}
						{stage === "pickers" && <button type="button" data-testid="setup-save" disabled={!allPicked || saving} onClick={() => void save()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Saving…" : "Save models"}</button>}
					</div>
				</footer>}
			</div>
		</div>,
		document.body,
	);
}
