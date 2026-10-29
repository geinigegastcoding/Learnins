"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProviderMark } from "@/components/provider-mark";
import { notifySettingsSaved } from "@/components/settings-signal";
import { ConnectionDialog, ConnectionFooter, ConnectionRow } from "./connection-controls";
import { Toggle } from "./controls";

type Status = { enabled: boolean; connected: boolean; allowBackgroundUse: boolean; error: string | null };
const initial: Status = { enabled: false, connected: false, allowBackgroundUse: true, error: null };

/** The CLI owns sign-in; Learnins stores only consent and the account's local identity check. */
export function CodexConnection({ setup = false, labelClassName }: { setup?: boolean; labelClassName?: string }) {
	const [status, setStatus] = useState<Status>(initial), [open, setOpen] = useState(false);
	const [background, setBackground] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		void fetch("/api/codex").then((response) => response.ok ? response.json() : null).then((value: Status | null) => { if (active && value) setStatus(value); }).catch(() => undefined);
		return () => { active = false; };
	}, []);
	async function change(action: "connect" | "background" | "disconnect") {
		if (busy) return;
		setBusy(true); setError(null);
		try {
			const response = await fetch("/api/codex", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, allowBackgroundUse: background }) });
			const value = await response.json() as Status & { error?: string };
			if (!response.ok) throw new Error(value.error || "The connection could not be changed.");
			setStatus(value); notifySettingsSaved("keys"); setOpen(false);
		} catch (err) { setError(err instanceof Error ? err.message : "The connection could not be changed."); }
		finally { setBusy(false); }
	}
	return <div className="flex flex-col gap-2" data-testid="codex-connection">
		<ConnectionRow label="Local Codex" icon={setup ? <ProviderMark provider="chatgpt" className="size-5" /> : undefined} labelClassName={labelClassName} action={status.enabled ? "Manage…" : "Connect"} disabled={busy} onAction={() => { setBackground(status.allowBackgroundUse); setError(null); setOpen(true); }} />
		{status.enabled && !status.connected && <p className="text-xs text-muted-foreground">{status.error ?? "Connection unavailable"}</p>}
		{open && <ConnectionDialog label="Local Codex connection" testid="codex-connection-dialog" backdropTestid="codex-dialog-backdrop" busy={busy} onClose={() => { if (!busy) setOpen(false); }}>
			<h2 className="text-sm font-semibold text-foreground">Use your local Codex sign-in</h2>
			<p className="mt-3 text-xs leading-relaxed text-muted-foreground">Learnins uses the Codex CLI already installed and signed in on this computer. Your prompts, learning-tool results and relevant conversation context are sent through that account. Plan limits apply. Learnins does not copy your credentials or fall back to an API key.</p>
			<div className="mt-4 flex items-start gap-3 text-xs text-foreground">
				<Toggle label="Allow background use" checked={background} disabled={busy} onChange={setBackground} />
				<span>Allow background use<span className="mt-1 block leading-relaxed text-muted-foreground">Let helper agents and automatic follow-ups use this connection.</span></span>
			</div>
			{(error || status.error) && <p role="alert" className="mt-3 text-xs text-red-400">{error || status.error}</p>}
			<ConnectionFooter leading={status.enabled && <Button variant="ghost" size="sm" disabled={busy} className="text-red-400 hover:text-red-300" onClick={() => void change("disconnect")}>Disconnect</Button>}>
				<Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
				<Button size="sm" disabled={busy} onClick={() => void change(status.enabled && status.connected ? "background" : "connect")}>{busy ? "Connecting…" : status.enabled && status.connected ? "Save" : "Connect"}</Button>
			</ConnectionFooter>
		</ConnectionDialog>}
	</div>;
}
