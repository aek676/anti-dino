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
	{ command: "slots", description: "Ver las citas disponibles ahora mismo" },
	{ command: "subscribe", description: "Activar las alertas" },
	{ command: "unsubscribe", description: "Desactivar las alertas" },
];

const WELCOME = [
	[
		"<b>👋 ¡Hola! Vigilo la agenda de Elvis y te aviso en cuanto se libera una cita de Corte de pelo.</b>",
		"Así no te toca Dino y te ahorras el destrozo 🦖",
	].join("\n"),
	COMMANDS.map(
		({ command, description }) => `/${command} - ${description.toLowerCase()}`,
	).join("\n"),
	"Las alertas están activadas. Estas son las citas disponibles ahora mismo:",
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
			await ctx.reply(
				"Las alertas ya estaban activadas. Envía /slots para ver las citas.",
			);
			return;
		}
		await ctx.reply("Alertas activadas.");
		await deps.sendSlots(ctx.chatId);
	});

	bot.command("unsubscribe", (ctx) => {
		const changed = deps.unsubscribe(ctx.chatId);
		return ctx.reply(
			changed
				? "Alertas desactivadas. Envía /subscribe para volver a activarlas."
				: "Las alertas ya estaban desactivadas. Envía /subscribe para activarlas.",
		);
	});

	bot.on("my_chat_member", (ctx) => {
		const { status } = ctx.myChatMember.new_chat_member;
		if (status !== "kicked" && status !== "left") return;

		deps.unsubscribe(ctx.chatId);
		log.info({ chatId: ctx.chatId, status }, "Unsubscribed chat that left");
	});
};
