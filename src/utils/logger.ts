import { createPinoLogger } from "@bogeychan/elysia-logger";
import { env } from "@/utils/env";

export const log = createPinoLogger({
	level: env.LOG_LEVEL,
	redact: [
		"req.headers.authorization",
		'req.headers["x-telegram-bot-api-secret-token"]',
	],
});
