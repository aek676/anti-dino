import { Elysia } from "elysia";
import { Bot } from "grammy";
import { ENV } from "varlock/env";
import { createFreshaService, fresha } from "@/modules/fresha";
import { HEALTH_PATH, health } from "@/modules/health";
import { createSlotsRepository, createSlotsService } from "@/modules/slots";
import {
	createSubscribersRepository,
	createTelegramService,
	registerCommands,
	telegram,
} from "@/modules/telegram";
import { watchdog } from "@/modules/watchdog";
import { closeDatabase, db } from "@/utils/db";
import { log } from "@/utils/logger";

const bot = new Bot(ENV.TELEGRAM_BOT_TOKEN);

const subscribersRepository = createSubscribersRepository(db);

const telegramService = createTelegramService({
	repo: subscribersRepository,
	bot,
	adminChatId: ENV.ADMIN_CHAT_ID,
});

const slotsRepository = createSlotsRepository(db);

const slotsService = createSlotsService({
	repo: slotsRepository,
	send: telegramService.send,
});

registerCommands(bot, {
	subscribe: subscribersRepository.subscribe,
	unsubscribe: subscribersRepository.unsubscribe,
	isSubscribed: subscribersRepository.isSubscribed,
	sendSlots: slotsService.sendCurrent,
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
			repo: slotsRepository,
			fresha: createFreshaService(fetch, {
				stepDelayMs: ENV.FRESHA_STEP_DELAY_MS,
			}),
			notify: telegramService.notify,
			notifyAdmin: telegramService.notifyAdmin,
			edit: telegramService.edit,
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
