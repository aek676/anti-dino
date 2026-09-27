import { type Bot, type Context, GrammyError } from "grammy";
import { log } from "@/utils/logger";
import { CALLBACK_PATTERN } from "./callback";
import type { RemindersService, Reply } from "./service";
import type { View } from "./views";

const FAILED = "Algo ha fallado, inténtalo de nuevo.";

const reply = (ctx: Context, view: View) =>
	ctx.reply(view.text, { reply_markup: view.keyboard });

const show = async (ctx: Context, view: View) => {
	try {
		await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
	} catch (error) {
		if (
			error instanceof GrammyError &&
			error.description.includes("message is not modified")
		)
			return;
		throw error;
	}
};

export const registerReminders = (bot: Bot, service: RemindersService) => {
	bot.command("remind", (ctx) => reply(ctx, service.start()));

	bot.command("reminders", (ctx) => reply(ctx, service.list(ctx.chatId)));

	bot.callbackQuery(CALLBACK_PATTERN, async (ctx) => {
		const { chatId } = ctx;
		const { data, message } = ctx.callbackQuery;
		let result: Reply;

		try {
			result =
				chatId === undefined
					? { answer: service.brokenButton }
					: await service.press(chatId, data, message?.text ?? "");
			if (result.view) await show(ctx, result.view);
		} catch (error) {
			log.warn({ chatId, data, err: error }, "reminder callback failed");
			result = { answer: FAILED };
		}

		try {
			await ctx.answerCallbackQuery(
				result.answer ? { text: result.answer } : undefined,
			);
		} catch (error) {
			log.warn({ chatId, err: error }, "Failed to answer reminder callback");
		}
	});
};
