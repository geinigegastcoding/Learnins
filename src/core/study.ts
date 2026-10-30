/** Local study tools. Dates stored here are ISO instants, not display strings. */
export type Rating = "again" | "hard" | "good" | "easy";

export interface StudyCard {
	id: string;
	front: string;
	back: string;
	dueAt: string;
	intervalMinutes: number;
	sourceNodeId?: string;
}

export interface StudyDeck {
	id: string;
	name: string;
	cards: StudyCard[];
}

export interface StudyEvent {
	id: string;
	title: string;
	start: string;
	end: string;
	completed?: boolean;
}

export interface StudyExam {
	id: string;
	subject: string;
	date: string;
	topics: string[];
	events: StudyEvent[];
}

export interface StudyMaterial {
	id: string;
	name: string;
	text: string;
	createdAt: string;
	originalExtension?: string;
}

export interface StudyData {
	version: 1;
	revision: number;
	decks: StudyDeck[];
	exams: StudyExam[];
	materials: StudyMaterial[];
	projects: StudyProject[];
}

export interface StudyProject { id: string; name: string; notes: string; materialIds: string[] }

export const emptyStudyData = (): StudyData => ({ version: 1, revision: 0, decks: [], exams: [], materials: [], projects: [] });

/** A failed recall returns shortly; successful reviews grow the interval. */
export function reviewCard(card: StudyCard, rating: Rating, now = new Date()): StudyCard {
	const previous = card.intervalMinutes;
	const intervalMinutes = rating === "again" ? 1
		: rating === "hard" ? Math.max(720, Math.round(previous * 1.2))
		: rating === "good" ? Math.max(1440, Math.round(previous * 2))
		: Math.max(4320, Math.round(previous * 3));
	return { ...card, intervalMinutes, dueAt: new Date(now.getTime() + intervalMinutes * 60_000).toISOString() };
}

/** One study block per available day, starting at the learner's local time. */
export function planExam(input: {
	subject: string; date: string; topics: string[]; minutes: number; startTime: string;
	latestEndTime?: string; weekdays?: number[]; occupied?: StudyEvent[]; now?: Date;
}): StudyExam {
	const now = input.now ?? new Date();
	const exam = new Date(`${input.date}T00:00:00`);
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const topics = input.topics.map((t) => t.trim()).filter(Boolean);
	const validDate = /^\d{4}-\d{2}-\d{2}$/.test(input.date) && Number.isFinite(exam.getTime()) &&
		`${exam.getFullYear()}-${String(exam.getMonth() + 1).padStart(2, "0")}-${String(exam.getDate()).padStart(2, "0")}` === input.date;
	if (!input.subject.trim() || !topics.length || !validDate || exam <= start ||
		!Number.isInteger(input.minutes) || input.minutes < 15 || input.minutes > 480 ||
		!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) {
		throw new Error("Enter a subject, topics, a future exam date, a start time, and 15–480 minutes per day.");
	}
	const [hour, minute] = input.startTime.split(":").map(Number);
	if (hour! * 60 + minute! + input.minutes > 24 * 60) throw new Error("Choose a start time that lets the study block finish before midnight.");
	if (input.latestEndTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.latestEndTime)) throw new Error("Enter a valid latest finish time.");
	const [endHour, endMinute] = input.latestEndTime?.split(":").map(Number) ?? [];
	if (input.latestEndTime !== undefined && endHour! * 60 + endMinute! < hour! * 60 + minute! + input.minutes) throw new Error("The available time window must fit at least one study block.");
	const weekdays = input.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
	if (!weekdays.length) throw new Error("Choose at least one study day.");
	const events: StudyEvent[] = [];
	const occupied = (input.occupied ?? []).map((event) => ({ start: Date.parse(event.start), end: Date.parse(event.end) })).filter((event) => Number.isFinite(event.start) && Number.isFinite(event.end)).sort((a, b) => a.start - b.start);
	// Keep the generated plan bounded to the fortnight immediately before the exam.
	const first = new Date(exam);
	first.setDate(first.getDate() - 14);
	if (first < start) first.setTime(start.getTime());
	for (const day = new Date(first); day < exam; day.setDate(day.getDate() + 1)) {
		if (!weekdays.includes(day.getDay())) continue;
		const eventStart = new Date(day);
		eventStart.setHours(hour!, minute!, 0, 0);
		const latest = input.latestEndTime === undefined ? eventStart.getTime() + input.minutes * 60_000 : new Date(day.getFullYear(), day.getMonth(), day.getDate(), endHour!, endMinute!).getTime();
		if (eventStart <= now) {
			if (input.latestEndTime === undefined) continue;
			eventStart.setTime(Math.ceil((now.getTime() + 1) / 900_000) * 900_000);
		}
		for (const event of occupied) {
			if (event.start < eventStart.getTime() + input.minutes * 60_000 && event.end > eventStart.getTime()) eventStart.setTime(event.end);
		}
		const eventEnd = new Date(eventStart.getTime() + input.minutes * 60_000);
		if (eventEnd.getTime() > latest) continue;
		events.push({
			id: crypto.randomUUID(),
			title: input.subject.trim(),
			start: eventStart.toISOString(),
			end: eventEnd.toISOString(),
		});
	}
	// Do not silently drop topics when there are fewer study days than topics.
	// Group them evenly in that case; otherwise revisit them in rotation.
	for (const [index, event] of events.entries()) {
		const assigned = topics.length > events.length
			? topics.slice(Math.floor(index * topics.length / events.length), Math.floor((index + 1) * topics.length / events.length))
			: [topics[index % topics.length]!];
		event.title = `${input.subject.trim()}: ${assigned.join(", ")}`;
	}
	return { id: crypto.randomUUID(), subject: input.subject.trim(), date: input.date, topics, events };
}

function calendarTime(value: string): string {
	return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(event: StudyEvent): string {
	const url = new URL("https://calendar.google.com/calendar/render");
	url.searchParams.set("action", "TEMPLATE");
	url.searchParams.set("text", event.title);
	url.searchParams.set("dates", `${calendarTime(event.start)}/${calendarTime(event.end)}`);
	url.searchParams.set("details", "Study session planned with Learnins.");
	return url.toString();
}

function icsText(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function foldCalendarLine(line: string): string {
	let result = "";
	let bytes = 0;
	const encoder = new TextEncoder();
	for (const character of line) {
		const size = encoder.encode(character).length;
		if (bytes + size > 75) { result += "\r\n "; bytes = 1; }
		result += character;
		bytes += size;
	}
	return result;
}

export function calendarFile(events: StudyEvent[]): string {
	const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Learnins//Study planner//EN", "CALSCALE:GREGORIAN"];
	for (const event of events) lines.push(
		"BEGIN:VEVENT", `UID:${icsText(event.id)}@learnins`,
		`DTSTAMP:${calendarTime(new Date().toISOString())}`,
		`DTSTART:${calendarTime(event.start)}`, `DTEND:${calendarTime(event.end)}`,
		`SUMMARY:${icsText(event.title)}`, "END:VEVENT",
	);
	lines.push("END:VCALENDAR");
	return lines.map(foldCalendarLine).join("\r\n") + "\r\n";
}
