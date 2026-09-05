import { t, type UnwrapSchema } from "elysia";

export class FreshaError extends Error {
	constructor(
		message: string,
		readonly kind: "http" | "graphql" | "unknown-operation",
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
