import { createPinoLogger } from "@bogeychan/elysia-logger";
import { env } from "@/utils/env";

const isDev = env.NODE_ENV !== "production";

const stream = isDev
	? (await import("pino-pretty")).default({ sync: true })
	: undefined;

export const log = createPinoLogger({
	level: env.LOG_LEVEL,
	stream,
	redact: [
		"req.headers.authorization",
		'req.headers["x-telegram-bot-api-secret-token"]',
	],
});
