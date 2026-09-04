import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HEALTH_PATH, health } from "@/modules/health";
import { type Db, openDatabase } from "@/utils/db";

describe(`GET ${HEALTH_PATH}`, () => {
	let db: Db;

	beforeEach(() => {
		db = openDatabase(":memory:");
	});

	afterEach(() => {
		db.close();
	});

	const request = () =>
		health(db).handle(new Request(`http://localhost${HEALTH_PATH}`));

	test("responds 200 when healthy", async () => {
		const res = await request();

		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; uptime: number };
		expect(body.status).toBe("ok");
		expect(typeof body.uptime).toBe("number");
	});

	test("responds 503 when the database is unavailable", async () => {
		db.close();

		const res = await request();

		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ status: "error" });
	});
});
