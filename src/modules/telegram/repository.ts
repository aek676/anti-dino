import type { Db } from "@/utils/db";
import type { ChatId } from "./model";

export type SubscribersRepository = ReturnType<
	typeof createSubscribersRepository
>;

export const createSubscribersRepository = (db: Db) => {
	const insertSubscriber = db.query<
		void,
		{ chatId: number; createdAt: string }
	>(
		`INSERT OR IGNORE INTO subscribers (chat_id, created_at) VALUES (:chatId, :createdAt)`,
	);

	const deleteSubscriber = db.query<void, { chatId: number }>(
		`DELETE FROM subscribers WHERE chat_id = :chatId`,
	);

	const selectSubscriber = db.query<{ chat_id: number }, { chatId: number }>(
		`SELECT chat_id FROM subscribers WHERE chat_id = :chatId`,
	);

	const selectSubscribers = db.query<{ chat_id: number }, []>(
		`SELECT chat_id FROM subscribers`,
	);

	const subscribe = (chatId: ChatId) => {
		insertSubscriber.run({
			chatId,
			createdAt: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
		});
	};

	const unsubscribe = (chatId: ChatId) => {
		deleteSubscriber.run({ chatId });
	};

	const isSubscribed = (chatId: ChatId) =>
		selectSubscriber.get({ chatId }) !== null;

	const listSubscribers = (): ChatId[] =>
		selectSubscribers.all().map((row) => row.chat_id);

	return { subscribe, unsubscribe, isSubscribed, listSubscribers };
};
