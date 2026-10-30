import { readFile } from "node:fs/promises";
import { readStudy, studyMaterialPaths } from "@/src/server";

export async function GET(request: Request) {
	try {
		const id = new URL(request.url).searchParams.get("id") ?? "";
		const material = readStudy().materials.find((item) => item.id === id);
		const paths = material && studyMaterialPaths(id);
		if (!material || !paths) return Response.json({ error: "File unavailable." }, { status: 404 });
		const bytes = await readFile(paths.original);
		return new Response(bytes, { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(material.name.replace(/['()*]/g, "_"))}`, "x-content-type-options": "nosniff" } });
	} catch { return Response.json({ error: "File unavailable." }, { status: 404 }); }
}
