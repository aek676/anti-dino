import { Elysia } from "elysia";
import { ENV } from "varlock/env";
import { createFreshaService, fresha } from "@/modules/fresha";
import { HEALTH_PATH, health } from "@/modules/health";
import { watchdog } from "@/modules/watchdog";
import { closeDatabase, db } from "@/utils/db";
import { log } from "@/utils/logger";

const app = new Elysia()
	.use(
		log.into({
			autoLogging: { ignore: ({ path }) => path === HEALTH_PATH },
		}),
	)
	.use(health(db))
	.decorate("db", db)
	.use(fresha)
	.use(
		watchdog({
			db,
			fresha: createFreshaService(fetch, {
				stepDelayMs: ENV.FRESHA_STEP_DELAY_MS,
			}),
			// TODO: replace with the Telegram notifier
			notify: (text) => {
				log.info({ text }, "notify");
				return Promise.resolve();
			},
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
