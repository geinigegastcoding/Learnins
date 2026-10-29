import { stripTypeScriptTypes } from "node:module";
import { isLocalJsonMutation } from "@/src/server";

export async function POST(request: Request) {
	if (!isLocalJsonMutation(request)) return Response.json({ error: "Invalid request origin or content type." }, { status: 403 });
	try {
		const body = await request.json() as { code?: unknown };
		if (typeof body.code !== "string" || body.code.length > 100_000) {
			return Response.json({ error: "Code must be text under 100,000 characters." }, { status: 400 });
		}
		return Response.json({ code: stripTypeScriptTypes(body.code, { mode: "transform" }) });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "TypeScript could not be converted." }, { status: 400 });
	}
}
