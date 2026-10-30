import { readStudy } from "@/src/server";

export async function GET() {
	try { return Response.json(readStudy().projects.map(({ id, name }) => ({ id, name }))); }
	catch { return Response.json({ error: "Projects could not be loaded." }, { status: 500 }); }
}
