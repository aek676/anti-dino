import { status } from "elysia";
import type { Db } from "@/utils/db";

export const createHealthService = (db: Db) => {
	const check = () => {
		try {
			db.query("PRAGMA schema_version").get();
			return { status: "ok" as const, uptime: process.uptime() };
		} catch {
			return status(503, { status: "error" as const });
		}
	};

	return { check };
};
