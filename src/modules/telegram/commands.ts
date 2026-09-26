import type { Bot } from "grammy";
import type { ChatId } from "./model";

export type CommandsDeps = {
	register: (chatId: ChatId) => void;
	subscribe: (chatId: ChatId) => void;
	unsubscribe: (chatId: ChatId) => void;
	sendSlots: (chatId: ChatId) => Promise<void>;
};

// /start is left out on purpose: Telegram sends it when the chat opens, it is not a menu option.
export const COMMANDS = [
	{ command: "slots", description: "See the slots available right now" },
	{ command: "subscribe", description: "Turn alerts on" },
	{ command: "unsubscribe", description: "Turn alerts off" },
];

const WELCOME = [
	"<b>👋 Hi! I watch the salon's calendar and message you when a slot opens up.</b>",
	COMMANDS.map(
		({ command, description }) => `/${command} - ${description.toLowerCase()}`,
	).join("\n"),
	"Alerts are on. These are the slots available right now:",
].join("\n\n");

export const registerCommands = (bot: Bot, deps: CommandsDeps) => {
	bot.command("start", async (ctx) => {
		deps.register(ctx.chatId);
		await ctx.reply(WELCOME, { parse_mode: "HTML" });
		await deps.sendSlots(ctx.chatId);
	});

	bot.command("slots", (ctx) => deps.sendSlots(ctx.chatId));

	bot.command("subscribe", async (ctx) => {
		deps.subscribe(ctx.chatId);
		await ctx.reply("Alerts on.");
		await deps.sendSlots(ctx.chatId);
	});

	bot.command("unsubscribe", (ctx) => {
		deps.unsubscribe(ctx.chatId);
		return ctx.reply("Alerts off. Send /subscribe to turn them back on.");
	});
};
