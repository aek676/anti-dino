import { Elysia } from "elysia";
import { Bot } from "grammy";
import { ENV } from "varlock/env";
import { book, slotUrl } from "@/modules/book";
import { createFreshaService, fresha } from "@/modules/fresha";
import { HEALTH_PATH, health } from "@/modules/health";
import {
	createSlotsRepository,
	createSlotsService,
	type SlotsConfig,
} from "@/modules/slots";
import {
	createSubscribersRepository,
	createTelegramService,
	telegram,
} from "@/modules/telegram";
import { watchdog } from "@/modules/watchdog";
import { closeDatabase, openDatabase } from "@/utils/db";
import { log } from "@/utils/logger";

const db = openDatabase(ENV.DATABASE_PATH);

const bot = new Bot(ENV.TELEGRAM_BOT_TOKEN);

const subscribersRepository = createSubscribersRepository(db);

const telegramService = createTelegramService({
	repo: subscribersRepository,
	bot,
	adminChatId: ENV.ADMIN_CHAT_ID,
});

const slotsConfig: SlotsConfig = {
	employeeId: ENV.FRESHA_EMPLOYEE_ID,
	serviceId: ENV.FRESHA_SERVICE_ID,
	salonUrl: ENV.FRESHA_BOOKING_URL,
	slotUrl: (startsAt) => slotUrl(ENV.PUBLIC_URL, startsAt),
	timeZone: ENV.SALON_TIME_ZONE,
};

const slotsRepository = createSlotsRepository(db);

const slotsService = createSlotsService({
	repo: slotsRepository,
	send: telegramService.send,
	config: slotsConfig,
});

const freshaService = createFreshaService(fetch, {
	stepDelayMs: ENV.FRESHA_STEP_DELAY_MS,
});

const app = new Elysia()
	.use(
		log.into({
			autoLogging: { ignore: ({ path }) => path === HEALTH_PATH },
		}),
	)
	.use(health(db))
	.decorate("db", db)
	.use(fresha(freshaService))
	.use(
		watchdog({
			repo: slotsRepository,
			fresha: freshaService,
			notify: telegramService.notify,
			notifyAdmin: telegramService.notifyAdmin,
			edit: telegramService.edit,
			config: {
				...slotsConfig,
				locationId: String(ENV.FRESHA_LOCATION_ID),
				daysAhead: ENV.DAYS_AHEAD,
				failureThreshold: ENV.FAILURE_ALERT_THRESHOLD,
				checkIntervalMinutes: ENV.CHECK_INTERVAL_MINUTES,
			},
		}),
	)
	.use(
		book({
			fresha: freshaService,
			config: {
				locationId: String(ENV.FRESHA_LOCATION_ID),
				locationSlug: ENV.FRESHA_LOCATION_SLUG,
				serviceId: ENV.FRESHA_SERVICE_ID,
				employeeId: ENV.FRESHA_EMPLOYEE_ID,
				timeZone: ENV.SALON_TIME_ZONE,
			},
		}),
	)
	.use(
		telegram({
			bot,
			subscribe: subscribersRepository.subscribe,
			unsubscribe: subscribersRepository.unsubscribe,
			isSubscribed: subscribersRepository.isSubscribed,
			sendSlots: slotsService.sendCurrent,
		}),
	)
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
