import { isLocalJsonMutation, readStudy, writeStudy } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	try { return Response.json(readStudy()); }
	catch { return Response.json({ error: "Study data could not be read. The existing file was left untouched." }, { status: 500 }); }
}

export async function PUT(request: Request) {
	if (!isLocalJsonMutation(request)) return Response.json({ error: "Invalid request origin or content type." }, { status: 403 });
	const raw = await request.text();
	if (raw.length > 8_000_000) return Response.json({ error: "Study data is too large to save." }, { status: 413 });
	try {
		const value: unknown = JSON.parse(raw);
		// Library files have their own revision-checked endpoints. Preserve
		// them server-side when a cards/plans update omits their large text.
		if (value && typeof value === "object" && !Array.isArray(value) && !("materials" in value)) {
			(value as Record<string, unknown>).materials = readStudy().materials;
		}
		const saved = writeStudy(value);
		if (!saved) return Response.json({ error: "Study data changed in another window. Reload and try again." }, { status: 409 });
		return Response.json(saved);
	} catch (error) {
		if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
			return Response.json({ error: "Study data is invalid and was not saved." }, { status: 400 });
		}
		return Response.json({ error: "Study data could not be saved. The existing file was left untouched." }, { status: 500 });
	}
}
