/** The callback data of the buttons this module draws. Telegram caps it at 64 bytes. */

/** The /remind flow only carries the choice; the conversation remembers the day and start. */
export const flow = {
	page: (page: number) => `page:${page}`,
	day: (day: string) => `day:${day}`,
	range: (from: string, to: string) => `range:${from}-${to}`,
	other: "other",
	from: (time: string) => `from:${time}`,
	to: (time: string) => `to:${time}`,
	back: "back",
	cancel: "cancel",
};

/** Buttons that work on their own, whenever they are tapped: the list and the mode question. */
export const LIST_PATTERN = /^rem:/;

export type ModeSource = "confirm" | "list";

export type ListCallback =
	| { kind: "remove"; id: number }
	| { kind: "mode"; onlyReminders: boolean; source: ModeSource };

export const encodeList = (callback: ListCallback): string =>
	callback.kind === "remove"
		? `rem:remove:${callback.id}`
		: `rem:mode:${callback.onlyReminders ? "only" : "all"}:${callback.source}`;

/** The data comes from the client, so it is checked before it is trusted. */
export const parseList = (data: string): ListCallback | undefined => {
	const removed = data.match(/^rem:remove:(\d{1,12})$/);
	if (removed) return { kind: "remove", id: Number(removed[1]) };

	const mode = data.match(/^rem:mode:(only|all):(confirm|list)$/);
	if (mode)
		return {
			kind: "mode",
			onlyReminders: mode[1] === "only",
			source: mode[2] === "list" ? "list" : "confirm",
		};
};
