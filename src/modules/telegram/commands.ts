import type { Bot } from "grammy";
import { log } from "@/utils/logger";
import type { ChatId } from "./model";

export type CommandsDeps = {
	register: (chatId: ChatId) => void;
	subscribe: (chatId: ChatId) => boolean;
	unsubscribe: (chatId: ChatId) => boolean;
	sendSlots: (chatId: ChatId) => Promise<void>;
};

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
		if (!deps.subscribe(ctx.chatId)) {
			await ctx.reply("Alerts were already on. Send /slots to see the slots.");
			return;
		}
		await ctx.reply("Alerts on.");
		await deps.sendSlots(ctx.chatId);
	});

	bot.command("unsubscribe", (ctx) => {
		const changed = deps.unsubscribe(ctx.chatId);
		return ctx.reply(
			changed
				? "Alerts off. Send /subscribe to turn them back on."
				: "Alerts were already off. Send /subscribe to turn them on.",
		);
	});

	bot.on("my_chat_member", (ctx) => {
		const { status } = ctx.myChatMember.new_chat_member;
		if (status !== "kicked" && status !== "left") return;

		deps.unsubscribe(ctx.chatId);
		log.info({ chatId: ctx.chatId, status }, "Unsubscribed chat that left");
	});
};
