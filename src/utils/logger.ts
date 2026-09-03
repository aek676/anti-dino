import { createPinoLogger } from "@bogeychan/elysia-logger";

const isDev = Bun.env.NODE_ENV !== "production";

export const log = createPinoLogger({
	level: Bun.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
	transport: isDev ? { target: "pino-pretty" } : undefined,
	redact: [
		"req.headers.authorization",
		'req.headers["x-telegram-bot-api-secret-token"]',
	],
});
