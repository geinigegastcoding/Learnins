import { isLocalMutation, readSettingsRecord, writeSettingsRecord } from "@/src/server";

/** Store this on the server: Electron chooses a new localhost port at launch. */
export async function POST(request: Request) {
	if (!isLocalMutation(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
	const record = readSettingsRecord() ?? { version: 1 };
	writeSettingsRecord({ ...record, tutorialCompleted: true });
	return Response.json({ completed: true });
}
