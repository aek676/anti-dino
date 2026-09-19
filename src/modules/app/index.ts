import { Elysia } from "elysia";
import { Bot } from "grammy";
import { ENV } from "varlock/env";
import { createFreshaService, fresha } from "@/modules/fresha";
import { HEALTH_PATH, health } from "@/modules/health";
import { createTelegramService, telegram } from "@/modules/telegram";
import { createWatchdogService, watchdog } from "@/modules/watchdog";
import { closeDatabase, db } from "@/utils/db";
import { log } from "@/utils/logger";

const bot = new Bot(ENV.TELEGRAM_BOT_TOKEN);

const telegramService = createTelegramService({
	db,
	bot,
	adminChatId: ENV.ADMIN_CHAT_ID,
	sendSlots: (chatId) => watchdogService.sendSlots(chatId),
});

const watchdogService = createWatchdogService({
	db,
	fresha: createFreshaService(fetch, {
		stepDelayMs: ENV.FRESHA_STEP_DELAY_MS,
	}),
	send: telegramService.send,
	notify: telegramService.notify,
	notifyAdmin: telegramService.notifyAdmin,
	edit: telegramService.edit,
});

const app = new Elysia()
	.use(
		log.into({
			autoLogging: { ignore: ({ path }) => path === HEALTH_PATH },
		}),
	)
	.use(health(db))
	.decorate("db", db)
	.use(fresha())
	.use(watchdog(watchdogService))
	.use(telegram(bot))
	.onStop(({ store }) => {
		store.cron.watchdog.stop();
		closeDatabase(db);
	})
	.get("/", () => "Hello Elysia")
	.listen(ENV.PORT);

const shutdown = (signal: NodeJS.Signals): void => {
	log.info({ signal }, "shutting down");
	void app.stop();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
