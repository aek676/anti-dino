import { Elysia, status, t } from "elysia";
import { FreshaError, FreshaModel } from "./model";
import { createFreshaService } from "./service";

const service = createFreshaService();

export const fresha = new Elysia({ name: "fresha", prefix: "/fresha" }).get(
	"/services",
	async ({ query }) => {
		const result = await service.listServices(query.slug);
		return result instanceof FreshaError
			? status(502, { message: result.message, kind: result.kind })
			: result;
	},
	{
		query: t.Object({ slug: t.String({ minLength: 1 }) }),
		response: {
			200: t.Array(FreshaModel.service),
			502: FreshaModel.error,
		},
	},
);
