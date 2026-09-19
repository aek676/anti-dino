import { type Bot, InlineKeyboard } from "grammy";
import type { ChatId } from "./model";

export type CommandsDeps = {
	subscribe: (chatId: ChatId) => void;
	unsubscribe: (chatId: ChatId) => void;
	isSubscribed: (chatId: ChatId) => boolean;
	sendSlots: (chatId: ChatId) => Promise<void>;
};

export const COMMANDS = [
	{ command: "start", description: "Subscribe to the alerts" },
	{ command: "slots", description: "See the slots available right now" },
	{ command: "stop", description: "Unsubscribe" },
];

const SUBSCRIBE_ACTION = "subscribe";

const WELCOME = [
	"<b>👋 Hi! I watch the salon's calendar and message you when a slot opens up.</b>",
	COMMANDS.map(
		({ command, description }) => `/${command} - ${description.toLowerCase()}`,
	).join("\n"),
	"Press the button to start.",
].join("\n\n");

export const registerCommands = (bot: Bot, deps: CommandsDeps) => {
	bot.command("start", (ctx) => {
		if (deps.isSubscribed(ctx.chatId)) return deps.sendSlots(ctx.chatId);

		return ctx.reply(WELCOME, {
			parse_mode: "HTML",
			reply_markup: new InlineKeyboard().text("🚀 Start", SUBSCRIBE_ACTION),
		});
	});

	bot.callbackQuery(SUBSCRIBE_ACTION, async (ctx) => {
		await ctx.answerCallbackQuery();
		if (ctx.chatId === undefined) return;

		deps.subscribe(ctx.chatId);
		await ctx.editMessageReplyMarkup();
		await ctx.reply("You have subscribed to notifications.");
		await deps.sendSlots(ctx.chatId);
	});

	bot.command("slots", (ctx) => deps.sendSlots(ctx.chatId));

	bot.command("stop", (ctx) => {
		deps.unsubscribe(ctx.chatId);
		return ctx.reply("You have unsubscribed from notifications.");
	});
};
