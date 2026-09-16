import type { Bot } from "grammy";
import type { Db } from "@/utils/db";
import { log } from "@/utils/logger";

export type TelegramDeps = {
	db: Db;
	adminChatId: number;
	bot: Bot;
};

export const createTelegramService = (deps: TelegramDeps) => {
	const subscribe = (chatId: number) => {
		const query = deps.db.query<void, { chatId: number; createdAt: string }>(
			`INSERT OR IGNORE INTO subscribers (chat_id, created_at) VALUES (:chatId, :createdAt)`,
		);
		query.run({ chatId, createdAt: new Date().toISOString() });
	};

	const unsubscribe = (chatId: number) => {
		const query = deps.db.query<void, { chatId: number }>(
			`DELETE FROM subscribers WHERE chat_id = :chatId`,
		);
		query.run({ chatId });
	};

	const listSubscribers = () => {
		const query = deps.db.query<{ chat_id: number }, []>(
			`SELECT chat_id FROM subscribers`,
		);
		return query.all().map((row) => row.chat_id);
	};

	const notify = async (text: string) => {
		const users = new Set([...listSubscribers(), deps.adminChatId]);
		let delivered = 0;
		for (const chatId of users) {
			try {
				await deps.bot.api.sendMessage(chatId, text);
				delivered++;
			} catch (error) {
				log.warn(
					{ chatId, err: error },
					"Failed to send message to subscriber",
				);
			}
		}

		if (users.size > 0 && delivered <= 0)
			throw new Error(
				`Failed to send message to subscribers. Delivered: ${delivered}, Total: ${users.size}`,
			);
	};

	deps.bot.command("start", (ctx) => {
		subscribe(ctx.chatId);
		return ctx.reply("You have subscribed to notifications.");
	});

	deps.bot.command("stop", (ctx) => {
		unsubscribe(ctx.chatId);
		return ctx.reply("You have unsubscribed from notifications.");
	});

	return { subscribe, unsubscribe, listSubscribers, notify };
};
