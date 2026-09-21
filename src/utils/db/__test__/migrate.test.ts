import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { connectDatabase, type Db, openDatabase } from "@/utils/db";
import { migrate, SCHEMA_VERSION, schemaVersion } from "@/utils/db/migrate";
import { migrations } from "@/utils/db/migrations";

describe("migrate", () => {
	let db: Db;

	beforeEach(() => {
		db = openDatabase(":memory:");
	});
	afterEach(() => {
		db.close();
	});

	test("openDatabase applies every migration", () => {
		expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
		expect(SCHEMA_VERSION).toBe(migrations.length);
	});

	test("creates the tables", () => {
		const rows = db
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
			)
			.all()
			.map((row) => row.name);
		expect(rows).toEqual(["alerts", "slots", "subscribers"]);
	});

	test("is idempotent", () => {
		migrate(db);
		expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
	});

	test("keeps the slots already stored as live when they become history", () => {
		const old = connectDatabase(":memory:");
		for (const migration of migrations.slice(0, 4)) migration.up(old);
		old.run("PRAGMA user_version = 4");
		old.run(
			"INSERT INTO slots VALUES ('7', 's:1', '2026-09-17T11:30', '2026-09-14T10:00:00.000Z')",
		);

		migrate(old);

		expect(schemaVersion(old)).toBe(SCHEMA_VERSION);
		expect(old.query("SELECT * FROM slots").all()).toEqual([
			{
				employee_id: "7",
				service_id: "s:1",
				starts_at: "2026-09-17T11:30",
				seen_at: "2026-09-14T10:00:00.000Z",
				last_seen_at: "2026-09-14T10:00:00.000Z",
				gone_at: null,
			},
		]);
		old.close();
	});

	test("migration names are unique", () => {
		const names = migrations.map((migration) => migration.name);
		expect(new Set(names).size).toBe(names.length);
	});
});
