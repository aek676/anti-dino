import { Elysia } from "elysia";
import { closeDatabase, db } from "@/utils/db";
import { env } from "@/utils/env";
import { log } from "@/utils/logger";

const app = new Elysia()
	.use(log.into({ autoLogging: true }))
	.onStop(() => {
		closeDatabase(db);
	})
	.get("/", () => "Hello Elysia")
	.listen(env.PORT);

const shutdown = (signal: NodeJS.Signals): void => {
	log.info({ signal }, "shutting down");
	void app.stop();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
