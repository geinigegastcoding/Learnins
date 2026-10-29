import ts from "typescript";
import { isLocalJsonMutation } from "@/src/server";

export async function POST(request: Request) {
	if (!isLocalJsonMutation(request)) return Response.json({ error: "Invalid request origin or content type." }, { status: 403 });
	try {
		const body = await request.json() as { code?: unknown };
		if (typeof body.code !== "string" || body.code.length > 100_000) {
			return Response.json({ error: "Code must be text under 100,000 characters." }, { status: 400 });
		}
		const result = ts.transpileModule(body.code, {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
			reportDiagnostics: true,
		});
		const error = result.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
		if (error) return Response.json({ error: ts.flattenDiagnosticMessageText(error.messageText, "\n") }, { status: 400 });
		return Response.json({ code: result.outputText });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "TypeScript could not be converted." }, { status: 400 });
	}
}
