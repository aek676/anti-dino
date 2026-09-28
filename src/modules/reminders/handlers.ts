import { createConversation } from "@grammyjs/conversations";
import type { Bot } from "grammy";
import type { BotContext } from "@/modules/telegram";
import { log } from "@/utils/logger";
import { LIST_PATTERN, parseList } from "./callback";
import {
	BROKEN_BUTTON,
	createRemindConversation,
	FAILED,
	REMIND,
	REMIND_TIMEOUT_MS,
} from "./conversation";
import { reply, show } from "./render";
import type { RemindersService } from "./service";
import * as views from "./views";

export const registerReminders = (
	bot: Bot<BotContext>,
	service: RemindersService,
) => {
	bot.use(
		createConversation(createRemindConversation(service), {
			id: REMIND,
			maxMillisecondsToWait: REMIND_TIMEOUT_MS,
		}),
	);

	// A second /remind drops the picker that was open and starts over.
	bot.command("remind", async (ctx) => {
		await ctx.conversation.exit(REMIND);
		await ctx.conversation.enter(REMIND, ctx.chatId);
	});

	bot.command("reminders", (ctx) => reply(ctx, service.list(ctx.chatId)));

	bot.callbackQuery(LIST_PATTERN, async (ctx) => {
		const { chatId } = ctx;
		const callback = parseList(ctx.callbackQuery.data);
		if (!callback || chatId === undefined)
			return ctx.answerCallbackQuery({ text: BROKEN_BUTTON });

		try {
			if (callback.kind === "remove") {
				const removed = service.remove(chatId, callback.id);
				await show(ctx, service.list(chatId));
				await ctx.answerCallbackQuery(
					removed ? { text: "Aviso quitado" } : undefined,
				);
				return;
			}

			service.setMode(chatId, callback.onlyReminders);
			await show(
				ctx,
				callback.source === "list"
					? service.list(chatId)
					: views.modeChosen(
							ctx.callbackQuery.message?.text ?? "",
							callback.onlyReminders,
						),
			);
			await ctx.answerCallbackQuery();
		} catch (error) {
			log.warn(
				{ chatId, data: ctx.callbackQuery.data, err: error },
				"reminder callback failed",
			);
			await ctx.answerCallbackQuery({ text: FAILED });
		}
	});

	// Whatever the conversation did not take: buttons from before this code, or from a
	// picker that expired or was replaced by a newer /remind.
	bot.on("callback_query:data", (ctx) =>
		ctx.answerCallbackQuery({ text: BROKEN_BUTTON }),
	);
};
