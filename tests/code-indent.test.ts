import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { indentCode } from "../src/core/code-indent.ts";

describe("code indentation", () => {
	it("inserts spaces at the caret without losing code", () => {
		assert.deepEqual(indentCode("abc", 1, 1, false), { value: "a  bc", start: 3, end: 3 });
	});
	it("indents and unindents selected lines, leaving the next line alone", () => {
		const indented = indentCode("one\ntwo\nthree", 0, 8, false);
		assert.deepEqual(indented, { value: "  one\n  two\nthree", start: 0, end: 12 });
		assert.deepEqual(indentCode(indented.value, indented.start, indented.end, true), { value: "one\ntwo\nthree", start: 0, end: 8 });
	});
	it("unindents a caret line with either spaces or a tab", () => {
		assert.deepEqual(indentCode("  one", 5, 5, true), { value: "one", start: 3, end: 3 });
		assert.deepEqual(indentCode("\tone", 1, 1, true), { value: "one", start: 0, end: 0 });
	});
	it("keeps a selection valid when it ends inside removed indentation", () => {
		assert.deepEqual(indentCode("a\n  b", 0, 3, true), { value: "a\nb", start: 0, end: 2 });
	});
});
