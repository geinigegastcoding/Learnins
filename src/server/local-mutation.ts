/** Reject browser requests from a different origin, including simple forms. */
export function isLocalMutation(request: Request): boolean {
	const site = request.headers.get("sec-fetch-site");
	if (site && site !== "same-origin" && site !== "none") return false;
	const origin = request.headers.get("origin");
	if (!origin) return true; // Non-browser local clients need not send Origin.
	try {
		const target = new URL(request.url);
		return new URL(origin).origin === `${target.protocol}//${request.headers.get("host") ?? target.host}`;
	} catch { return false; }
}

/** JSON is not a browser simple-form content type. */
export function isLocalJsonMutation(request: Request): boolean {
	return isLocalMutation(request) && request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
