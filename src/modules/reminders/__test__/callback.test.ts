import { describe, expect, test } from "bun:test";
import { encodeList, flow, type ListCallback, parseList } from "../callback";

const bytes = (data: string) => new TextEncoder().encode(data).length;

describe("list callbacks", () => {
	const all: ListCallback[] = [
		{ kind: "remove", id: 123456 },
		{ kind: "mode", onlyReminders: true, source: "confirm" },
		{ kind: "mode", onlyReminders: false, source: "list" },
	];

	test.each(all)("round-trips %o within Telegram's 64 bytes", (callback) => {
		const data = encodeList(callback);
		expect(bytes(data)).toBeLessThanOrEqual(64);
		expect(parseList(data)).toEqual(callback);
	});

	test.each(["", "rem:", "rem:remove:abc", "rem:mode:maybe:list", "r:x:12"])(
		"rejects %p",
		(data) => {
			expect(parseList(data)).toBeUndefined();
		},
	);
});

describe("flow callbacks", () => {
	test("the longest button fits in Telegram's 64 bytes", () => {
		expect(bytes(flow.range("00:00", "24:00"))).toBeLessThanOrEqual(64);
		expect(bytes(flow.day("2026-10-03"))).toBeLessThanOrEqual(64);
	});
});
