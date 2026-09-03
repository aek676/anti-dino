import { createPinoLogger } from "@bogeychan/elysia-logger";
import { env } from "@/utils/env";

const isDev = env.NODE_ENV !== "production";

export const log = createPinoLogger({
	level: env.LOG_LEVEL,
	transport: isDev ? { target: "pino-pretty" } : undefined,
	redact: [
		"req.headers.authorization",
		'req.headers["x-telegram-bot-api-secret-token"]',
	],
});
