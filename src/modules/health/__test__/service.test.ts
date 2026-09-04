import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ElysiaCustomStatusResponse } from "elysia";
import { createHealthService } from "@/modules/health/service";
import { type Db, openDatabase } from "@/utils/db";

describe("health service", () => {
	let db: Db;

	beforeEach(() => {
		db = openDatabase(":memory:");
	});

	afterEach(() => {
		db.close();
	});

	test("reports ok with uptime when the database answers", () => {
		const result = createHealthService(db).check();

		expect(result).toMatchObject({ status: "ok" });
		expect(result).toHaveProperty("uptime", expect.any(Number));
	});

	test("returns 503 status when the database is closed", () => {
		db.close();

		const result = createHealthService(db).check();

		expect(result).toBeInstanceOf(ElysiaCustomStatusResponse);
		expect(result).toMatchObject({ code: 503, response: { status: "error" } });
	});
});
