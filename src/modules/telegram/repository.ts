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

	const register = (chatId: ChatId) => {
		insertSubscriber.run({ chatId, now: now() });
	};

	const subscribe = (chatId: ChatId): boolean =>
		upsertSubscriber.run({ chatId, now: now() }).changes > 0;

	const unsubscribe = (chatId: ChatId): boolean =>
		muteSubscriber.run({ chatId, now: now() }).changes > 0;

	const listSubscribers = (): ChatId[] =>
		selectSubscribers.all().map((row) => row.chat_id);

	return { register, subscribe, unsubscribe, listSubscribers };
};
