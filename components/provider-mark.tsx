import type { CSSProperties } from "react";

const providerAssets: Record<string, string> = {
	openai: "/siwc/chatgpt-logo-white.svg",
	chatgpt: "/siwc/chatgpt-logo-white.svg",
	anthropic: "/brands/anthropic.svg",
	google: "/brands/google.svg",
	openrouter: "/brands/openrouter.svg",
	opencode: "/brands/opencode.svg",
	xai: "/brands/xai.svg",
	grok: "/brands/xai.svg",
	githubcopilot: "/brands/githubcopilot.svg",
	"github-copilot": "/brands/githubcopilot.svg",
};

/** A small decorative mark for a provider. */
export function ProviderMark({
	provider,
	className,
}: {
	provider: string;
	className?: string;
}) {
	const id = provider.trim().toLowerCase();
	const asset = providerAssets[id];
	const classes = ["inline-flex shrink-0 items-center justify-center", className].filter(Boolean).join(" ");

	if (asset) {
		return (
			<span
				className={classes}
				aria-hidden="true"
				style={{
					backgroundColor: "currentColor",
					maskImage: `url(${asset})`,
					WebkitMaskImage: `url(${asset})`,
					maskRepeat: "no-repeat",
					WebkitMaskRepeat: "no-repeat",
					maskPosition: "center",
					WebkitMaskPosition: "center",
					maskSize: "contain",
					WebkitMaskSize: "contain",
				} as CSSProperties}
			/>
		);
	}

	return (
		<span className={classes} aria-hidden="true">
			<svg className="size-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
				<circle cx="12" cy="12" r="8.5" />
				<path d="M8 12h8M12 8v8" />
			</svg>
		</span>
	);
}
