import { addStudyMaterial, deleteStudyMaterial, isLocalJsonMutation, isLocalMutation, studyMaterialPaths } from "@/src/server";

export async function GET(request: Request) {
	try {
		const id = new URL(request.url).searchParams.get("id") ?? "";
		const paths = studyMaterialPaths(id);
		return paths ? Response.json(paths) : Response.json({ error: "The original file is not available for this older import." }, { status: 404 });
	} catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The file is unavailable." }, { status: 400 }); }
}

export async function POST(request: Request) {
	if (!isLocalMutation(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
	try {
		const length = Number(request.headers.get("content-length") ?? 0);
		if (length > 21 * 1024 * 1024) return Response.json({ error: "Choose a file smaller than 20 MB." }, { status: 413 });
		const form = await request.formData();
		const file = form.get("file");
		const revisionValue = form.get("revision");
		const revision = Number(revisionValue);
		if (!(file instanceof File) || typeof revisionValue !== "string" || !/^\d+$/.test(revisionValue) || !Number.isSafeInteger(revision)) return Response.json({ error: "Choose a file to import." }, { status: 400 });
		const saved = await addStudyMaterial(file, revision);
		return saved ? Response.json(saved) : Response.json({ error: "Study data changed in another window. Reload and try again." }, { status: 409 });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "The file could not be imported." }, { status: 400 });
	}
}

export async function DELETE(request: Request) {
	if (!isLocalJsonMutation(request)) return Response.json({ error: "Invalid request origin or content type." }, { status: 403 });
	try {
		const body = await request.json() as { id?: unknown; revision?: unknown };
		if (typeof body.id !== "string" || !Number.isInteger(body.revision)) return Response.json({ error: "Invalid material request." }, { status: 400 });
		const saved = deleteStudyMaterial(body.id, body.revision as number);
		return saved ? Response.json(saved) : Response.json({ error: "Study data changed in another window. Reload and try again." }, { status: 409 });
	} catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The file could not be removed." }, { status: 400 }); }
}
