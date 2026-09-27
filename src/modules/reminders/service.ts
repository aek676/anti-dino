import type { ChatId, SubscribersRepository } from "@/modules/telegram";
import { formatWallClock } from "@/utils/date";
import type { Transaction } from "@/utils/db";
import { type Callback, parse } from "./callback";
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

/** What to do with a button tap: the view that replaces the message, and a toast. */
export type Reply = { view?: views.View; answer?: string };

export type RemindersService = ReturnType<typeof createRemindersService>;

const BROKEN_BUTTON = "Este botón ya no funciona. Usa /remind.";
const DAY_GONE = "Ese día ya no está disponible";

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

	const start = (): views.View => views.dayPicker(today(), config.daysAhead, 0);

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

	const save = async (
		chatId: ChatId,
		range: ReminderModel["reminderRange"],
	): Promise<Reply> => {
		const result = add(chatId, range);
		if (result.status === "limit") return { view: views.limitReached };
		if (result.status === "duplicate")
			return { view: views.duplicate(result.reminder) };

		const askMode = subscribers.getOnlyReminders(chatId) === null;
		await deps.sendMatching(chatId, (startsAt) =>
			matches(result.reminder, startsAt),
		);
		return { view: views.saved(result.reminder, askMode) };
	};

	const handle = (
		chatId: ChatId,
		callback: Callback,
		messageText: string,
	): Reply | Promise<Reply> => {
		switch (callback.kind) {
			case "page": {
				const last = views.pageCount(config.daysAhead) - 1;
				return {
					view: views.dayPicker(
						today(),
						config.daysAhead,
						Math.min(callback.page, last),
					),
				};
			}
			case "day":
				return {
					view: views.rangePicker(
						callback.day,
						views.pageOf(today(), callback.day),
					),
				};
			case "from":
				return { view: views.fromPicker(callback.day) };
			case "to":
				return { view: views.toPicker(callback.day, callback.from) };
			case "save":
				return save(chatId, {
					day: callback.day,
					from: callback.from,
					to: callback.to,
				});
			case "remove": {
				const removed = repo.remove(chatId, callback.id);
				return {
					view: list(chatId),
					answer: removed ? "Aviso quitado" : undefined,
				};
			}
			case "mode":
				subscribers.setOnlyReminders(chatId, callback.onlyReminders);
				return {
					view:
						callback.source === "list"
							? list(chatId)
							: views.modeChosen(messageText, callback.onlyReminders),
				};
			case "cancel":
				return { view: views.cancelled };
		}
	};

	/** `messageText` is the text of the message the button sits on. */
	const press = async (
		chatId: ChatId,
		data: string,
		messageText: string,
	): Promise<Reply> => {
		const callback = parse(data);
		if (!callback) return { answer: BROKEN_BUTTON };

		if ("day" in callback && !isBookable(callback.day))
			return {
				view: views.dayPicker(today(), config.daysAhead, 0, `${DAY_GONE}.`),
				answer: DAY_GONE,
			};

		return await handle(chatId, callback, messageText);
	};

	return { start, list, press, brokenButton: BROKEN_BUTTON };
};
