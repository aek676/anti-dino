import { Elysia } from "elysia";
import type { Db } from "@/utils/db";
import { HealthModel } from "./model";
import { createHealthService } from "./service";

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
