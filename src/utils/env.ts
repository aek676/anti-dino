import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const schema = Type.Object({
	NODE_ENV: Type.Union(
		[
			Type.Literal("development"),
			Type.Literal("production"),
			Type.Literal("test"),
		],
		{ default: "development" },
	),
	PORT: Type.Number({ default: 3000, minimum: 1, maximum: 65535 }),
	LOG_LEVEL: Type.Union(
		[
			Type.Literal("trace"),
			Type.Literal("debug"),
			Type.Literal("info"),
			Type.Literal("warn"),
			Type.Literal("error"),
			Type.Literal("fatal"),
			Type.Literal("silent"),
		],
		{ default: "info" },
	),

	WEBHOOK_PATH: Type.String({ minLength: 1 }),
	PUBLIC_URL: Type.String({ minLength: 1 }),

	TELEGRAM_BOT_TOKEN: Type.String({ minLength: 1 }),
	TELEGRAM_WEBHOOK_SECRET: Type.String({ minLength: 1 }),
	ADMIN_CHAT_ID: Type.String({ minLength: 1 }),

	FRESHA_LOCATION_ID: Type.String({ minLength: 1 }),
	FRESHA_EMPLOYEE_ID: Type.String({ minLength: 1 }),
	FRESHA_SERVICE_ID: Type.String({ minLength: 1 }),
	FRESHA_BOOKING_URL: Type.String({ minLength: 1 }),

	CHECK_INTERVAL_MINUTES: Type.Number({ default: 5, minimum: 1 }),
	DAYS_AHEAD: Type.Number({ default: 31, minimum: 1 }),
	MAX_DAYS_PER_CHECK: Type.Number({ default: 8, minimum: 1 }),
	FRESHA_STEP_DELAY_MS: Type.Number({ default: 1500, minimum: 0 }),
	FAILURE_ALERT_THRESHOLD: Type.Number({ default: 5, minimum: 1 }),

	DATABASE_PATH: Type.String({ default: "./data/anti-dino.sqlite" }),
});

export type Env = typeof schema.static;

const parse = (): Env => {
	const raw = { ...Bun.env };
	try {
		return Value.Parse(schema, raw);
	} catch {
		const normalized = Value.Convert(schema, Value.Default(schema, raw));
		const problems = new Map<string, string>();
		for (const { path, message } of Value.Errors(schema, normalized)) {
			const name = path.slice(1);
			if (!problems.has(name)) problems.set(name, `${name}: ${message}`);
		}
		throw new Error(
			`Invalid environment:\n  ${[...problems.values()].join("\n  ")}`,
		);
	}
};

export const env: Readonly<Env> = Object.freeze(parse());
