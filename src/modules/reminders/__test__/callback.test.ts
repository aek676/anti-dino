import { describe, expect, test } from "bun:test";
import { type Callback, encode, parse } from "../callback";

const all: Callback[] = [
	{ kind: "page", page: 3 },
	{ kind: "day", day: "2026-10-03" },
	{ kind: "from", day: "2026-10-03" },
	{ kind: "to", day: "2026-10-03", from: "16:00" },
	{ kind: "save", day: "2026-10-03", from: "00:00", to: "24:00" },
	{ kind: "remove", id: 123456 },
	{ kind: "mode", onlyReminders: true, source: "confirm" },
	{ kind: "mode", onlyReminders: false, source: "list" },
	{ kind: "cancel" },
];

describe("reminder callbacks", () => {
	test.each(all)("round-trips %o within Telegram's 64 bytes", (callback) => {
		const data = encode(callback);
		expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
		expect(parse(data)).toEqual(callback);
	});

	test.each([
		"",
		"x:d:2026-10-03",
		"r:",
		"r:d:2026-13-01",
		"r:d:2026-02-30",
		"r:t:2026-10-03:2500",
		"r:s:2026-10-03:1600:1600",
		"r:s:2026-10-03:1700:1600",
		"r:s:2026-10-03:1600:2430",
		"r:m:maybe:c",
		"r:x:abc",
	])("rejects %p", (data) => {
		expect(parse(data)).toBeUndefined();
	});
});
