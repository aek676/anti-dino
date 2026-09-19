import { type Bot, GrammyError, InlineKeyboard } from "grammy";
import type { Db } from "@/utils/db";
import { log } from "@/utils/logger";
import type { ChatId, Delivery, Message, MessageId } from "./model";

export type TelegramDeps = {
	db: Db;
	adminChatId: number;
	bot: Bot;
	sendSlots: (chatId: ChatId) => Promise<void>;
};

const SUBSCRIBE_ACTION = "subscribe";

const WELCOME = [
	"<b>👋 Hi! I watch the salon's calendar and message you when a slot opens up.</b>",
	[
		"/start - subscribe to the alerts",
		"/slots - see the slots available right now",
		"/stop - unsubscribe",
	].join("\n"),
	"Press the button to start.",
].join("\n\n");

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

	const isSubscribed = (chatId: number) => {
		const query = deps.db.query<{ chat_id: number }, { chatId: number }>(
			`SELECT chat_id FROM subscribers WHERE chat_id = :chatId`,
		);
		return query.get({ chatId }) !== null;
	};

	const listSubscribers = () => {
		const query = deps.db.query<{ chat_id: number }, []>(
			`SELECT chat_id FROM subscribers`,
		);
		return query.all().map((row) => row.chat_id);
	};

	const edit = async (
		chatId: ChatId,
		messageId: MessageId,
		message: Message,
	) => {
		try {
			await deps.bot.api.editMessageText(
				chatId,
				messageId,
				message.text,
				toOptions(message),
			);
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
		}
	};

	const notify = async (message: Message): Promise<Delivery> => {
		const users = new Set([...listSubscribers(), deps.adminChatId]);
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

	deps.bot.command("start", (ctx) => {
		if (isSubscribed(ctx.chatId)) return deps.sendSlots(ctx.chatId);

		return ctx.reply(WELCOME, {
			parse_mode: "HTML",
			reply_markup: new InlineKeyboard().text("🚀 Start", SUBSCRIBE_ACTION),
		});
	});

	deps.bot.callbackQuery(SUBSCRIBE_ACTION, async (ctx) => {
		await ctx.answerCallbackQuery();
		if (ctx.chatId === undefined) return;

		subscribe(ctx.chatId);
		await ctx.editMessageReplyMarkup();
		await ctx.reply("You have subscribed to notifications.");
		await deps.sendSlots(ctx.chatId);
	});

	deps.bot.command("slots", (ctx) => deps.sendSlots(ctx.chatId));

	deps.bot.command("stop", (ctx) => {
		unsubscribe(ctx.chatId);
		return ctx.reply("You have unsubscribed from notifications.");
	});

	return {
		subscribe,
		unsubscribe,
		isSubscribed,
		listSubscribers,
		send,
		notify,
		notifyAdmin,
		edit,
	};
};
