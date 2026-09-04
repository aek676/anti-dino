import { Elysia } from "elysia";
import { HealthModel } from "@/modules/health/model";
import { createHealthService } from "@/modules/health/service";
import type { Db } from "@/utils/db";

export const HEALTH_PATH = "/healthz";

export const health = (db: Db) => {
	const service = createHealthService(db);

	return new Elysia({ name: "health" }).get(
		HEALTH_PATH,
		() => service.check(),
		{
			response: {
				200: HealthModel.ok,
				503: HealthModel.error,
			},
		},
	);
};
