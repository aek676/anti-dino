import { Elysia, status, t } from "elysia";
import type { Bot } from "grammy";
import { ENV } from "varlock/env";
import { log } from "@/utils/logger";
import { COMMANDS } from "./commands";

export { registerCommands } from "./commands";

export type {
	ChatId,
	Delivery,
	LinkButton,
	Message,
	MessageId,
} from "./model";
export { escapeHtml } from "./model";
export { createTelegramService } from "./service";

export const telegram = (bot: Bot) => {
	return new Elysia({ name: "telegram" })
		.onStart(async () => {
			try {
				await bot.init();
				await bot.api.setMyCommands(COMMANDS);
				await bot.api.setWebhook(ENV.PUBLIC_URL + ENV.WEBHOOK_PATH, {
					secret_token: ENV.TELEGRAM_WEBHOOK_SECRET,
				});
			} catch (error) {
				log.error({ err: error });
			}
		})
		.post(
			ENV.WEBHOOK_PATH,
			async ({ headers, body }) => {
				if (
					headers["x-telegram-bot-api-secret-token"] !==
					ENV.TELEGRAM_WEBHOOK_SECRET
				)
					return status(401);

				await bot.handleUpdate(body);
				return status(200);
			},
			{
				body: t.Any(),
			},
		);
};
