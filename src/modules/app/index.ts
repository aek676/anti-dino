import { Elysia } from "elysia";
import { ENV } from "varlock/env";
import { fresha } from "@/modules/fresha";
import { HEALTH_PATH, health } from "@/modules/health";
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
	.onStop(() => {
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
