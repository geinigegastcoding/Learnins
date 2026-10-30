import { isLocalJsonMutation, readStudy, setChatProject } from "@/src/server";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (!isLocalJsonMutation(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
	const body = await request.json().catch(() => null) as { projectId?: unknown } | null;
	if (!body || (body.projectId !== null && (typeof body.projectId !== "string" || !readStudy().projects.some((p) => p.id === body.projectId)))) return Response.json({ error: "Project not found." }, { status: 400 });
	const { id } = await params;
	return setChatProject(id, body.projectId as string | null) ? Response.json({ ok: true }) : Response.json({ error: "Session not found." }, { status: 404 });
}
