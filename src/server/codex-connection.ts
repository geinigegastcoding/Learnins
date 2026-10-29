import { piModels } from "../agent/models.ts";
import { codexStatus, connectCodex, disconnectCodex, refreshCodexModels, setCodexBackground } from "../agent/codex-bridge.ts";
import { isLocalJsonMutation } from "./local-mutation.ts";

const supported = () => piModels().getModels("openai");
export async function codexConnectionResponse(request: Request): Promise<Response> {
	if (request.method === "GET") {
		await refreshCodexModels(supported());
		return Response.json(codexStatus(), { headers: { "Cache-Control": "no-store" } });
	}
	if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
	if (!isLocalJsonMutation(request)) return Response.json({ error: "Invalid request origin or content type." }, { status: 403 });
	let body: { action?: unknown; allowBackgroundUse?: unknown };
	try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
	try {
		if (body?.action === "connect" && typeof body.allowBackgroundUse === "boolean") await connectCodex(supported(), body.allowBackgroundUse);
		else if (body?.action === "background" && typeof body.allowBackgroundUse === "boolean") setCodexBackground(body.allowBackgroundUse);
		else if (body?.action === "disconnect") disconnectCodex();
		else return Response.json({ error: "Invalid request." }, { status: 400 });
		return Response.json(codexStatus(), { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		const safe = /Codex CLI is not installed|Codex must be signed in|Codex account identity is unavailable|Codex MCP isolation failed|No compatible Codex models|connection settings could not be read/.test(message) ? message : "Local Codex could not be connected. Check its sign-in and try again.";
		return Response.json({ error: safe }, { status: 503, headers: { "Cache-Control": "no-store" } });
	}
}
