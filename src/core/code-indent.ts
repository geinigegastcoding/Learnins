/** Indent selected lines or insert two spaces at the caret in a code textarea. */
export function indentCode(value: string, start: number, end: number, unindent: boolean) {
	start = Math.max(0, Math.min(start, value.length));
	end = Math.max(start, Math.min(end, value.length));
	if (start === end && !unindent) {
		return { value: value.slice(0, start) + "  " + value.slice(end), start: start + 2, end: end + 2 };
	}
	const first = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
	const lastPosition = end > start && value[end - 1] === "\n" ? end - 1 : end;
	const nextBreak = value.indexOf("\n", lastPosition);
	const last = nextBreak < 0 ? value.length : nextBreak;
	const edits: Array<{ at: number; removed: number; added: number }> = [];
	let position = first;
	const lines = value.slice(first, last).split("\n").map((line) => {
		const removed = unindent ? (line.match(/^(?:\t| {1,2})/)?.[0].length ?? 0) : 0;
		edits.push({ at: position, removed, added: unindent ? 0 : 2 });
		position += line.length + 1;
		return unindent ? line.slice(removed) : `  ${line}`;
	});
	const map = (offset: number) => offset + edits.reduce((delta, edit) => offset <= edit.at ? delta : delta + edit.added - Math.min(edit.removed, offset - edit.at), 0);
	const nextStart = map(start);
	const nextEnd = map(end);
	return { value: value.slice(0, first) + lines.join("\n") + value.slice(last), start: nextStart, end: nextEnd };
}
