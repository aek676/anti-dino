import { Elysia } from "elysia";
import { Bot } from "grammy";
import { ENV } from "varlock/env";
import { createFreshaService, fresha } from "@/modules/fresha";
import { HEALTH_PATH, health } from "@/modules/health";
import { createTelegramService, telegram } from "@/modules/telegram";
import { watchdog } from "@/modules/watchdog";
import { closeDatabase, db } from "@/utils/db";
import { log } from "@/utils/logger";

const bot = new Bot(ENV.TELEGRAM_BOT_TOKEN);

const telegramService = createTelegramService({
	db,
	bot,
	adminChatId: ENV.ADMIN_CHAT_ID,
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
	.use(
		watchdog({
			db,
			fresha: createFreshaService(fetch, {
				stepDelayMs: ENV.FRESHA_STEP_DELAY_MS,
			}),
			notify: telegramService.notify,
		}),
	)
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
