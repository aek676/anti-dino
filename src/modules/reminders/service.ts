import type { ChatId, SubscribersRepository } from "@/modules/telegram";
import { formatWallClock } from "@/utils/date";
import type { Transaction } from "@/utils/db";
import { MAX_REMINDERS, type ReminderModel } from "./model";
import type { RemindersRepository } from "./repository";
import * as views from "./views";

export const matches = (
	range: ReminderModel["reminderRange"],
	startsAt: string,
): boolean => {
	const time = startsAt.slice(11);
	return (
		startsAt.slice(0, 10) === range.day && time >= range.from && time < range.to
	);
};

export const matchesAny = (
	ranges: ReminderModel["reminderRange"][],
	startsAt: string,
) => ranges.some((range) => matches(range, startsAt));

export type RemindersConfig = { timeZone: string; daysAhead: number };

export type RemindersDeps = {
	repo: RemindersRepository;
	subscribers: Pick<
		SubscribersRepository,
		"getOnlyReminders" | "setOnlyReminders"
	>;
	/** Sends the slots that are already open and match, if any. */
	sendMatching: (
		chatId: ChatId,
		isMatch: (startsAt: string) => boolean,
	) => Promise<void>;
	transaction: Transaction;
	config: RemindersConfig;
	now?: () => Temporal.Instant;
};

/** Plain data, so the conversation can store it between taps. */
export type SaveResult =
	| { status: "expired" }
	| { status: "limit" }
	| { status: "duplicate"; reminder: ReminderModel["reminder"] }
	| { status: "added"; reminder: ReminderModel["reminder"]; askMode: boolean };

export type RemindersService = ReturnType<typeof createRemindersService>;

export const createRemindersService = (deps: RemindersDeps) => {
	const { repo, subscribers, transaction, config } = deps;

	/** The salon's date, `YYYY-MM-DD`. */
	const today = () =>
		formatWallClock(
			(deps.now ?? Temporal.Now.instant)(),
			config.timeZone,
		).slice(0, 10);

	/** Fresha is only checked `daysAhead` days out, so later days could never match. */
	const isBookable = (day: string) => {
		const first = today();
		const last = Temporal.PlainDate.from(first)
			.add({ days: config.daysAhead - 1 })
			.toString();
		return day >= first && day <= last;
	};

	const onlyReminders = (chatId: ChatId) =>
		subscribers.getOnlyReminders(chatId) ?? false;

	const list = (chatId: ChatId): views.View =>
		views.list(repo.listByChat(chatId, today()), onlyReminders(chatId));

	/** Refuses a reminder the chat already has, or one past the limit. */
	const add = (
		chatId: ChatId,
		range: ReminderModel["reminderRange"],
	): ReminderModel["addResult"] =>
		transaction(() => {
			const existing = repo.find(chatId, range);
			if (existing) return { status: "duplicate", reminder: existing };

			if (repo.countActive(chatId, today()) >= MAX_REMINDERS)
				return { status: "limit" };

			return { status: "added", reminder: repo.insert(chatId, range) };
		});

	/** Checks the day again: the button may be tapped long after it was drawn. */
	const save = async (
		chatId: ChatId,
		range: ReminderModel["reminderRange"],
	): Promise<SaveResult> => {
		if (!isBookable(range.day)) return { status: "expired" };

		const result = add(chatId, range);
		if (result.status === "limit") return result;
		if (result.status === "duplicate")
			return { status: "duplicate", reminder: result.reminder };

		const askMode = subscribers.getOnlyReminders(chatId) === null;
		await deps.sendMatching(chatId, (startsAt) =>
			matches(result.reminder, startsAt),
		);
		return { status: "added", reminder: result.reminder, askMode };
	};

	const remove = (chatId: ChatId, id: number): boolean =>
		repo.remove(chatId, id);

	const setMode = (chatId: ChatId, onlyReminders: boolean): void => {
		subscribers.setOnlyReminders(chatId, onlyReminders);
	};

	return {
		today,
		isBookable,
		daysAhead: config.daysAhead,
		list,
		save,
		remove,
		setMode,
	};
};
