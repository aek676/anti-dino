import type { ChatId } from "@/modules/telegram";
import type { Db } from "@/utils/db";
import type { ReminderModel } from "./model";

export type RemindersRepository = ReturnType<typeof createRemindersRepository>;

type Row = {
	id: number;
	chat_id: number;
	day: string;
	from_time: string;
	to_time: string;
};

const toReminder = (row: Row): ReminderModel["reminder"] => ({
	id: row.id,
	chatId: row.chat_id,
	day: row.day,
	from: row.from_time,
	to: row.to_time,
});

const now = () =>
	Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });

export const createRemindersRepository = (db: Db) => {
	const selectOne = db.query<
		Row,
		{ chatId: ChatId } & ReminderModel["reminderRange"]
	>(
		`SELECT id, chat_id, day, from_time, to_time FROM reminders
		WHERE chat_id = :chatId AND day = :day AND from_time = :from AND to_time = :to`,
	);

	const selectCount = db.query<
		{ n: number },
		{ chatId: ChatId; today: string }
	>(
		"SELECT COUNT(*) AS n FROM reminders WHERE chat_id = :chatId AND day >= :today",
	);

	const insertOne = db.query<
		Row,
		{ chatId: ChatId; now: string } & ReminderModel["reminderRange"]
	>(
		`INSERT INTO reminders (chat_id, day, from_time, to_time, created_at)
		VALUES (:chatId, :day, :from, :to, :now)
		RETURNING id, chat_id, day, from_time, to_time`,
	);

	const selectByChat = db.query<Row, { chatId: ChatId; today: string }>(
		`SELECT id, chat_id, day, from_time, to_time FROM reminders
		WHERE chat_id = :chatId AND day >= :today
		ORDER BY day, from_time, to_time`,
	);

	const selectActive = db.query<
		Row & { only_reminders: number | null },
		{ today: string }
	>(
		`SELECT r.id, r.chat_id, r.day, r.from_time, r.to_time, s.only_reminders
		FROM reminders r LEFT JOIN subscribers s ON s.chat_id = r.chat_id
		WHERE r.day >= :today
		ORDER BY r.chat_id, r.day, r.from_time`,
	);

	const deleteOne = db.query<void, { chatId: ChatId; id: number }>(
		"DELETE FROM reminders WHERE chat_id = :chatId AND id = :id",
	);

	const deleteOlder = db.query<void, { today: string }>(
		"DELETE FROM reminders WHERE day < :today",
	);

	const find = (
		chatId: ChatId,
		range: ReminderModel["reminderRange"],
	): ReminderModel["reminder"] | null => {
		const row = selectOne.get({
			chatId,
			day: range.day,
			from: range.from,
			to: range.to,
		});
		return row ? toReminder(row) : null;
	};

	const countActive = (chatId: ChatId, today: string): number =>
		selectCount.get({ chatId, today })?.n ?? 0;

	const insert = (
		chatId: ChatId,
		range: ReminderModel["reminderRange"],
	): ReminderModel["reminder"] => {
		const row = insertOne.get({
			chatId,
			day: range.day,
			from: range.from,
			to: range.to,
			now: now(),
		});
		if (!row) throw new Error("Failed to insert reminder");
		return toReminder(row);
	};

	const listByChat = (
		chatId: ChatId,
		today: string,
	): ReminderModel["reminder"][] =>
		selectByChat.all({ chatId, today }).map(toReminder);

	const listAudience = (
		today: string,
	): Map<ChatId, ReminderModel["audience"]> => {
		const audience = new Map<ChatId, ReminderModel["audience"]>();
		for (const row of selectActive.all({ today })) {
			const entry = audience.get(row.chat_id) ?? {
				reminders: [],
				onlyReminders: row.only_reminders === 1,
			};
			entry.reminders.push(toReminder(row));
			audience.set(row.chat_id, entry);
		}
		return audience;
	};

	const remove = (chatId: ChatId, id: number): boolean =>
		deleteOne.run({ chatId, id }).changes > 0;

	const deleteBefore = (today: string) => {
		deleteOlder.run({ today });
	};

	return {
		find,
		countActive,
		insert,
		listByChat,
		listAudience,
		remove,
		deleteBefore,
	};
};
