import { type Bot, GrammyError, InlineKeyboard } from "grammy";
import { log } from "@/utils/logger";
import type { ChatId, Delivery, Message, MessageId } from "./model";
import type { SubscribersRepository } from "./repository";

export type TelegramDeps = {
	repo: Pick<SubscribersRepository, "listSubscribers" | "unsubscribe">;
	adminChatId: number;
	bot: Bot;
};

// Telegram sends 400 when the message or chat is gone and 403 when the bot is blocked.
const BLOCKED = 403;
const PERMANENT_ERROR_CODES = new Set([400, 403]);

const isBlocked = (error: unknown) =>
	error instanceof GrammyError && error.error_code === BLOCKED;

const isPermanent = (error: unknown) =>
	error instanceof GrammyError && PERMANENT_ERROR_CODES.has(error.error_code);

const toOptions = ({ buttons = [] }: Message) => ({
	parse_mode: "HTML" as const,
	link_preview_options: { is_disabled: true },
	reply_markup: InlineKeyboard.from(
		buttons.map((row) =>
			row.map((button) => InlineKeyboard.url(button.label, button.url)),
		),
	),
});

export const createTelegramService = (deps: TelegramDeps) => {
	const edit = async (
		chatId: ChatId,
		messageId: MessageId,
		message: Message,
	): Promise<boolean> => {
		try {
			await deps.bot.api.editMessageText(
				chatId,
				messageId,
				message.text,
				toOptions(message),
			);
			return true;
		} catch (error) {
			if (
				error instanceof GrammyError &&
				error.description.includes("message is not modified")
			)
				return true;

			log.warn(
				{ chatId, message: messageId, err: error },
				"Failed to edit message",
			);
			return isPermanent(error);
		}
	};

	const send = async (
		chatId: ChatId,
		message: Message,
	): Promise<MessageId | undefined> => {
		try {
			const { message_id } = await deps.bot.api.sendMessage(
				chatId,
				message.text,
				toOptions(message),
			);
			return message_id;
		} catch (error) {
			log.warn({ chatId, err: error }, "Failed to send message");
			if (isBlocked(error)) {
				deps.repo.unsubscribe(chatId);
				log.info({ chatId }, "Unsubscribed chat that blocked the bot");
			}
		}
	};

	const notify = async (message: Message): Promise<Delivery> => {
		const users = new Set([...deps.repo.listSubscribers(), deps.adminChatId]);
		const delivered = new Map();
		for (const chatId of users) {
			const messageId = await send(chatId, message);
			if (messageId !== undefined) delivered.set(chatId, messageId);
		}

		if (users.size > 0 && delivered.size <= 0)
			throw new Error(
				`Failed to send message to subscribers. Delivered: ${delivered.size}, Total: ${users.size}`,
			);

		return delivered;
	};

	const notifyAdmin = async (message: Message) => {
		await send(deps.adminChatId, message);
	};

	return { send, notify, notifyAdmin, edit };
};
