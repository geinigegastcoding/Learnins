import { addGoogleCalendarEvents, cancelGoogleCalendarLogin, disconnectGoogleCalendar, googleCalendarStatus, startGoogleCalendarLogin } from "./google-calendar.ts";
import { isLocalJsonMutation } from "./local-mutation.ts";
import { readStudy } from "./study.ts";

export async function googleCalendarResponse(request: Request): Promise<Response> {
	if (request.method === "GET") return Response.json(await googleCalendarStatus(), { headers: { "Cache-Control": "no-store" } });
	if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
	if (!isLocalJsonMutation(request)) return Response.json({ error: "Invalid request origin or content type." }, { status: 403 });
	let body: { action?: unknown; examId?: unknown };
	try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
	if (body?.action === "connect" || body?.action === "cancel" || body?.action === "disconnect") {
		try {
			if (body.action === "connect") startGoogleCalendarLogin();
			else if (body.action === "cancel") cancelGoogleCalendarLogin();
			else disconnectGoogleCalendar();
			return Response.json(await googleCalendarStatus(), { headers: { "Cache-Control": "no-store" } });
		} catch (error) {
			const message = error instanceof Error && /Install Google Workspace CLI|Set up a Google Workspace CLI OAuth client/.test(error.message) ? error.message : "Could not change the Google Calendar connection.";
			return Response.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
		}
	}
	if (typeof body?.examId !== "string" || body.examId.length > 120) return Response.json({ error: "Choose a study plan." }, { status: 400 });
	let events;
	try { events = readStudy().exams.find((exam) => exam.id === body.examId)?.events; }
	catch { return Response.json({ error: "Study data could not be read." }, { status: 500 }); }
	if (!events) return Response.json({ error: "Study plan not found." }, { status: 404 });
	if (!events.length || events.length > 100) return Response.json({ error: "A plan must contain between 1 and 100 study blocks." }, { status: 400 });
	const status = await googleCalendarStatus();
	if (!status.connected) return Response.json({ error: status.message ?? "Google Calendar is not connected." }, { status: 503 });
	const result = await addGoogleCalendarEvents(events, undefined, request.signal);
	return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
