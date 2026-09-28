import type {
	ConversationData,
	VersionedStateStorage,
} from "@grammyjs/conversations";
import type { Db } from "@/utils/db";
import type { ChatId } from "./model";

export type SubscribersRepository = ReturnType<
	typeof createSubscribersRepository
>;

const now = () =>
	Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });

export const createSubscribersRepository = (db: Db) => {
	const insertSubscriber = db.query<void, { chatId: number; now: string }>(
		`INSERT OR IGNORE INTO subscribers (chat_id, created_at, notify)
		VALUES (:chatId, :now, 1)`,
	);

	const upsertSubscriber = db.query<void, { chatId: number; now: string }>(
		`INSERT INTO subscribers (chat_id, created_at, notify)
		VALUES (:chatId, :now, 1)
		ON CONFLICT (chat_id) DO UPDATE SET notify = 1, updated_at = :now
		WHERE notify = 0`,
	);

	const muteSubscriber = db.query<void, { chatId: number; now: string }>(
		`UPDATE subscribers SET notify = 0, updated_at = :now
		WHERE chat_id = :chatId AND notify = 1`,
	);

	const selectSubscribers = db.query<{ chat_id: number }, []>(
		`SELECT chat_id FROM subscribers WHERE notify = 1`,
	);

	const selectOnlyReminders = db.query<
		{ only_reminders: number | null },
		{ chatId: number }
	>("SELECT only_reminders FROM subscribers WHERE chat_id = :chatId");

	const upsertOnlyReminders = db.query<
		void,
		{ chatId: number; only: number; now: string }
	>(
		`INSERT INTO subscribers (chat_id, created_at, notify, only_reminders)
		VALUES (:chatId, :now, 1, :only)
		ON CONFLICT (chat_id) DO UPDATE SET only_reminders = :only, updated_at = :now`,
	);

	const register = (chatId: ChatId) => {
		insertSubscriber.run({ chatId, now: now() });
	};

	const subscribe = (chatId: ChatId): boolean =>
		upsertSubscriber.run({ chatId, now: now() }).changes > 0;

	const unsubscribe = (chatId: ChatId): boolean =>
		muteSubscriber.run({ chatId, now: now() }).changes > 0;

	const listSubscribers = (): ChatId[] =>
		selectSubscribers.all().map((row) => row.chat_id);

	const getOnlyReminders = (chatId: ChatId): boolean | null => {
		const value = selectOnlyReminders.get({ chatId })?.only_reminders;
		return value === undefined || value === null ? null : value === 1;
	};

	const setOnlyReminders = (chatId: ChatId, onlyReminders: boolean) => {
		upsertOnlyReminders.run({
			chatId,
			only: onlyReminders ? 1 : 0,
			now: now(),
		});
	};

	return {
		register,
		subscribe,
		unsubscribe,
		listSubscribers,
		getOnlyReminders,
		setOnlyReminders,
	};
};

export const createConversationsRepository = <S = ConversationData>(
	db: Db,
): VersionedStateStorage<string, S> => {
	const selectOne = db.query<{ data: string }, { key: string }>(
		"SELECT data FROM conversations WHERE key = :key",
	);

	const upsert = db.query<void, { key: string; data: string; now: string }>(
		`INSERT INTO conversations (key, data, updated_at)
		VALUES (:key, :data, :now)
		ON CONFLICT (key) DO UPDATE SET data = :data, updated_at = :now`,
	);

	const deleteOne = db.query<void, { key: string }>(
		"DELETE FROM conversations WHERE key = :key",
	);

	return {
		read: (key) => {
			const row = selectOne.get({ key });
			return row ? JSON.parse(row.data) : undefined;
		},
		write: (key, state) => {
			upsert.run({ key, data: JSON.stringify(state), now: now() });
		},
		delete: (key) => {
			deleteOne.run({ key });
		},
	};
};
