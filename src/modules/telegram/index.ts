import { Elysia, status, t } from "elysia";
import type { Bot } from "grammy";
import { log } from "@/utils/logger";
import { COMMANDS, type CommandsDeps, registerCommands } from "./commands";

export type {
	ChatId,
	Delivery,
	LinkButton,
	Message,
	MessageId,
} from "./model";
export { escapeHtml } from "./model";
export {
	createSubscribersRepository,
	type SubscribersRepository,
} from "./repository";
export { createTelegramService } from "./service";

export type TelegramConfig = {
	publicUrl: string;
	webhookPath: string;
	webhookSecret: string;
};

export type TelegramPluginDeps = {
	bot: Bot;
	config: TelegramConfig;
} & CommandsDeps;

export const telegram = ({ bot, config, ...commands }: TelegramPluginDeps) => {
	registerCommands(bot, commands);

	return new Elysia({ name: "telegram" })
		.onStart(async () => {
			try {
				await bot.init();
				await bot.api.setMyCommands(COMMANDS);
				await bot.api.setWebhook(config.publicUrl + config.webhookPath, {
					secret_token: config.webhookSecret,
				});
			} catch (error) {
				log.error({ err: error });
			}
		})
		.post(
			config.webhookPath,
			async ({ headers, body }) => {
				if (headers["x-telegram-bot-api-secret-token"] !== config.webhookSecret)
					return status(401);

				await bot.handleUpdate(body);
				return status(200);
			},
			{
				body: t.Any(),
			},
		);
};
