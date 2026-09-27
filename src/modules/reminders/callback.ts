/**
 * The whole /remind flow lives in the inline buttons' callback data, so nothing is kept
 * between taps. Telegram caps callback data at 64 bytes; the longest here is 24.
 */

export type ModeSource = "confirm" | "list";

export type Callback =
	| { kind: "page"; page: number }
	| { kind: "day"; day: string }
	| { kind: "from"; day: string }
	| { kind: "to"; day: string; from: string }
	| { kind: "save"; day: string; from: string; to: string }
	| { kind: "remove"; id: number }
	| { kind: "mode"; onlyReminders: boolean; source: ModeSource }
	| { kind: "cancel" };

export const PREFIX = "r:";

/** Matches the callback data of every button this module draws. */
export const CALLBACK_PATTERN = /^r:/;

const DAY = String.raw`\d{4}-\d{2}-\d{2}`;
const TIME = String.raw`\d{4}`;

const toTime = (hhmm: string) => `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
const fromTime = (time: string) => time.replace(":", "");

const isTime = (time: string) => {
	const hours = Number(time.slice(0, 2));
	const minutes = Number(time.slice(3));
	return (hours < 24 && minutes < 60) || time === "24:00";
};

const isDay = (day: string) => {
	try {
		return (
			Temporal.PlainDate.from(day, { overflow: "reject" }).toString() === day
		);
	} catch {
		return false;
	}
};

export const encode = (callback: Callback): string => {
	switch (callback.kind) {
		case "page":
			return `${PREFIX}p:${callback.page}`;
		case "day":
			return `${PREFIX}d:${callback.day}`;
		case "from":
			return `${PREFIX}f:${callback.day}`;
		case "to":
			return `${PREFIX}t:${callback.day}:${fromTime(callback.from)}`;
		case "save":
			return `${PREFIX}s:${callback.day}:${fromTime(callback.from)}:${fromTime(callback.to)}`;
		case "remove":
			return `${PREFIX}x:${callback.id}`;
		case "mode":
			return `${PREFIX}m:${callback.onlyReminders ? "only" : "all"}:${callback.source === "list" ? "l" : "c"}`;
		case "cancel":
			return `${PREFIX}c`;
	}
};

const PATTERNS: [RegExp, (groups: string[]) => Callback][] = [
	[/^p:(\d{1,2})$/, ([page]) => ({ kind: "page", page: Number(page) })],
	[new RegExp(`^d:(${DAY})$`), ([day = ""]) => ({ kind: "day", day })],
	[new RegExp(`^f:(${DAY})$`), ([day = ""]) => ({ kind: "from", day })],
	[
		new RegExp(`^t:(${DAY}):(${TIME})$`),
		([day = "", from = ""]) => ({ kind: "to", day, from: toTime(from) }),
	],
	[
		new RegExp(`^s:(${DAY}):(${TIME}):(${TIME})$`),
		([day = "", from = "", to = ""]) => ({
			kind: "save",
			day,
			from: toTime(from),
			to: toTime(to),
		}),
	],
	[/^x:(\d{1,12})$/, ([id]) => ({ kind: "remove", id: Number(id) })],
	[
		/^m:(only|all):([cl])$/,
		([mode, source]) => ({
			kind: "mode",
			onlyReminders: mode === "only",
			source: source === "l" ? "list" : "confirm",
		}),
	],
	[/^c$/, () => ({ kind: "cancel" })],
];

const isValid = (callback: Callback): boolean => {
	switch (callback.kind) {
		case "day":
		case "from":
			return isDay(callback.day);
		case "to":
			return isDay(callback.day) && isTime(callback.from);
		case "save":
			return (
				isDay(callback.day) &&
				isTime(callback.from) &&
				isTime(callback.to) &&
				callback.from < callback.to
			);
		default:
			return true;
	}
};

export const parse = (data: string): Callback | undefined => {
	if (!data.startsWith(PREFIX)) return;
	const body = data.slice(PREFIX.length);

	for (const [pattern, build] of PATTERNS) {
		if (!pattern.test(body)) continue;
		const callback = build(body.match(pattern)?.slice(1) ?? []);
		return isValid(callback) ? callback : undefined;
	}
};
