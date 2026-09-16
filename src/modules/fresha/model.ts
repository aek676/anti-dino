import { t, type UnwrapSchema } from "elysia";

export class FreshaError extends Error {
	constructor(
		message: string,
		readonly kind: "http" | "graphql" | "unknown-operation",
		readonly status?: number,
	) {
		super(message);
		this.name = "FreshaError";
	}
}

export const FreshaModel = {
	service: t.Object({
		variantId: t.String(),
		catalogId: t.String(),
		name: t.String(),
		duration: t.Nullable(t.String()),
		price: t.Nullable(t.String()),
	}),
	employee: t.Object({
		id: t.Number(),
		name: t.String(),
	}),
	slot: t.Object({
		date: t.String({ format: "date" }),
		time: t.String({ pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }),
	}),
	error: t.Object({
		message: t.String(),
		kind: t.Union([
			t.Literal("http"),
			t.Literal("graphql"),
			t.Literal("unknown-operation"),
		]),
	}),
};

export type FreshaModel = {
	[K in keyof typeof FreshaModel]: UnwrapSchema<(typeof FreshaModel)[K]>;
};
