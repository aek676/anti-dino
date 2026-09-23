import { Elysia, status, t } from "elysia";
import { ENV } from "varlock/env";
import { FreshaError, FreshaModel } from "./model";
import type { FreshaService } from "./service";

export { FreshaError, type FreshaModel } from "./model";
export { createFreshaService, type FreshaService } from "./service";

export const fresha = (freshaService: FreshaService) => {
	return new Elysia({ name: "fresha", prefix: "/fresha" })
		.get(
			"/services",
			async ({ query }) => {
				const result = await freshaService.listServices(query.slug);
				return result instanceof FreshaError
					? status(502, { message: result.message, kind: result.kind })
					: result;
			},
			{
				query: t.Object({
					slug: t.String({ minLength: 1 }),
				}),
				response: {
					200: t.Array(FreshaModel.service),
					502: FreshaModel.error,
				},
			},
		)
		.get(
			"/employees",
			async ({ query }) => {
				const result = await freshaService.listEmployees(
					query.slug,
					query.variantId,
				);
				return result instanceof FreshaError
					? status(502, { message: result.message, kind: result.kind })
					: result;
			},
			{
				query: t.Object({
					slug: t.String({ minLength: 1 }),
					variantId: t.String({ minLength: 1 }),
				}),
				response: {
					200: t.Array(FreshaModel.employee),
					502: FreshaModel.error,
				},
			},
		)
		.get(
			"/slots",
			async ({ query }) => {
				const result = await freshaService.listSlots(
					query.slug,
					query.variantId,
					query.employeeId,
					ENV.DAYS_AHEAD,
				);
				return result instanceof FreshaError
					? status(502, { message: result.message, kind: result.kind })
					: result;
			},
			{
				query: t.Object({
					slug: t.String({ minLength: 1 }),
					variantId: t.String({ minLength: 1 }),
					employeeId: t.Integer({ minimum: 1 }),
				}),
				response: {
					200: t.Array(FreshaModel.slot),
					502: FreshaModel.error,
				},
			},
		);
};
