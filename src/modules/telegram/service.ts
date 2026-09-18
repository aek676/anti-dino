import { type Bot, GrammyError } from "grammy";
import type { Db } from "@/utils/db";
import { log } from "@/utils/logger";
import type { ChatId, Delivery, MessageId } from "./model";

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
		query.run({
			chatId,
			createdAt: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
		});
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

	const edit = async (chatId: ChatId, messageId: MessageId, text: string) => {
		try {
			await deps.bot.api.editMessageText(chatId, messageId, text);
		} catch (error) {
			if (
				error instanceof GrammyError &&
				error.description.includes("message is not modified")
			)
				return;

			log.warn(
				{ chatId, message: messageId, err: error },
				"Failed to edit message",
			);
		}
	};

	const notify = async (text: string): Promise<Delivery> => {
		const users = new Set([...listSubscribers(), deps.adminChatId]);
		const delivered = new Map();
		for (const chatId of users) {
			try {
				const { message_id } = await deps.bot.api.sendMessage(chatId, text);
				delivered.set(chatId, message_id);
			} catch (error) {
				log.warn(
					{ chatId, err: error },
					"Failed to send message to subscriber",
				);
			}
		}

		if (users.size > 0 && delivered.size <= 0)
			throw new Error(
				`Failed to send message to subscribers. Delivered: ${delivered.size}, Total: ${users.size}`,
			);

		return delivered;
	};

	deps.bot.command("start", (ctx) => {
		subscribe(ctx.chatId);
		return ctx.reply("You have subscribed to notifications.");
	});

	deps.bot.command("stop", (ctx) => {
		unsubscribe(ctx.chatId);
		return ctx.reply("You have unsubscribed from notifications.");
	});

	return { subscribe, unsubscribe, listSubscribers, notify, edit };
};
