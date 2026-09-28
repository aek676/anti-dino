import {
	type ConversationData,
	conversations,
	type VersionedStateStorage,
} from "@grammyjs/conversations";
import { Elysia, status, t } from "elysia";
import type { Bot } from "grammy";
import { log } from "@/utils/logger";
import { COMMANDS, type CommandsDeps, registerCommands } from "./commands";
import type { BotContext } from "./model";

export type {
	BotContext,
	ChatId,
	Delivery,
	LinkButton,
	Message,
	MessageId,
} from "./model";
export { escapeHtml } from "./model";
export {
	createConversationsRepository,
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
	bot: Bot<BotContext>;
	conversations: VersionedStateStorage<string, ConversationData>;
	config: TelegramConfig;
	handlers?: ((bot: Bot<BotContext>) => void)[];
} & CommandsDeps;

const CONVERSATIONS_VERSION = 1;

export const telegram = ({
	bot,
	conversations: storage,
	config,
	handlers = [],
	...commands
}: TelegramPluginDeps) => {
	bot.use(
		conversations({
			storage: {
				type: "key",
				version: CONVERSATIONS_VERSION,
				adapter: storage,
			},
		}),
	);
	registerCommands(bot, commands);
	for (const register of handlers) register(bot);
	// Without this an error would make the webhook fail and Telegram would resend the update.
	bot.catch(({ error, ctx }) => {
		log.error({ err: error, updateId: ctx.update.update_id }, "update failed");
	});

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
