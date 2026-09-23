import type { FreshaModel } from "@/modules/fresha";
import type { Message } from "@/modules/telegram";
import { formatDay } from "@/utils/date";
import type { BookingLinks } from "./model";

export const slotKey = (slot: FreshaModel["slot"]) =>
	`${slot.date}T${slot.time}`;

const slotWord = (count: number) => (count === 1 ? "slot" : "slots");

const formatDays = (
	startTimes: string[],
	live: Set<string>,
	links: BookingLinks,
): string[] =>
	Object.entries(
		Object.groupBy(startTimes.toSorted(), (key) => key.slice(0, 10)),
	).map(([date, keys = []]) =>
		[
			`<b>${formatDay(date)}</b>`,
			keys
				.map((key) =>
					live.has(key)
						? `<a href="${links.slot(key)}">${key.slice(11)}</a>`
						: `<s>${key.slice(11)}</s>`,
				)
				.join("  "),
		].join("\n"),
	);

const formatAlert = (
	header: string,
	startTimes: string[],
	live: Set<string>,
	links: BookingLinks,
): Message => ({
	text: [`<b>${header}</b>`, ...formatDays(startTimes, live, links)].join(
		"\n\n",
	),
	buttons: startTimes.some((key) => live.has(key))
		? [[{ label: "Book on Fresha", url: links.salon }]]
		: [],
});

export const formatNewSlotsMessage = (
	startTimes: string[],
	links: BookingLinks,
): Message =>
	formatAlert(
		`🟢 ${startTimes.length} new ${slotWord(startTimes.length)}`,
		startTimes,
		new Set(startTimes),
		links,
	);

export const formatCurrentSlotsMessage = (
	startTimes: string[],
	links: BookingLinks,
): Message =>
	startTimes.length > 0
		? formatAlert(
				`🟢 ${startTimes.length} ${slotWord(startTimes.length)} available`,
				startTimes,
				new Set(startTimes),
				links,
			)
		: {
				text: "No slots available right now. I'll message you as soon as one opens up.",
			};

export const formatUpdatedMessage = (
	startTimes: string[],
	live: Set<string>,
	links: BookingLinks,
): Message => {
	const remaining = startTimes.filter((key) => live.has(key)).length;
	const header =
		remaining > 0
			? `🟡 ${remaining} of ${startTimes.length} ${slotWord(startTimes.length)} left`
			: "⚪ No slots left from this alert";

	return formatAlert(header, startTimes, live, links);
};
