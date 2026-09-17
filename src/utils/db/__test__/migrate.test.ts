import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Db, openDatabase } from "@/utils/db";
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

	test("migration names are unique", () => {
		const names = migrations.map((migration) => migration.name);
		expect(new Set(names).size).toBe(names.length);
	});
});
