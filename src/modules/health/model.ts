import { t, type UnwrapSchema } from "elysia";

export const HealthModel = {
	ok: t.Object({
		status: t.Literal("ok"),
		uptime: t.Number(),
	}),
	error: t.Object({
		status: t.Literal("error"),
	}),
};

export type HealthModel = {
	[K in keyof typeof HealthModel]: UnwrapSchema<(typeof HealthModel)[K]>;
};
