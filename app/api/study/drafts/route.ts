import { isLocalJsonMutation, parseCodingDrafts, readCodingDrafts, writeCodingDrafts } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	try { return Response.json({ saved: readCodingDrafts() }); }
	catch { return Response.json({ error: "Code drafts could not be read. The existing file was left untouched." }, { status: 500 }); }
}

export async function PUT(request: Request) {
	if (!isLocalJsonMutation(request)) return Response.json({ error: "Invalid request origin or content type." }, { status: 403 });
	const raw = await request.text();
	if (raw.length > 4_000_000) return Response.json({ error: "Code drafts are too large to save." }, { status: 413 });
	let value;
	try { value = parseCodingDrafts(JSON.parse(raw)); }
	catch { return Response.json({ error: "Code drafts are invalid and were not saved." }, { status: 400 }); }
	try {
		const saved = writeCodingDrafts(value);
		if (!saved) return Response.json({ error: "Code drafts changed in another window." }, { status: 409 });
		return Response.json(saved);
	} catch {
		return Response.json({ error: "Code drafts could not be saved. The existing file was left untouched." }, { status: 500 });
	}
}
