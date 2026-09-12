import { createPinoLogger } from "@bogeychan/elysia-logger";
import { ENV } from "varlock/env";

export const log = createPinoLogger({
	level: ENV.LOG_LEVEL,
	redact: [
		"req.headers.authorization",
		'req.headers["x-telegram-bot-api-secret-token"]',
	],
});
