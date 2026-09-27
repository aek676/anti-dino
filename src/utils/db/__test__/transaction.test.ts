import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTransaction, type Db, openDatabase } from "@/utils/db";

describe("transaction", () => {
	let db: Db;

	beforeEach(() => {
		db = openDatabase(":memory:");
		db.run("CREATE TABLE items (name TEXT NOT NULL)");
	});
	afterEach(() => {
		db.close();
	});

	const insert = (name: string) =>
		db.query("INSERT INTO items (name) VALUES (?)").run(name);
	const count = () =>
		db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM items").get()?.n;

	test("commits the writes and returns what the function returns", () => {
		const transaction = createTransaction(db);

		const result = transaction(() => {
			insert("a");
			insert("b");
			return "done";
		});

		expect(result).toBe("done");
		expect(count()).toBe(2);
	});

	test("rolls back every write when the function throws", () => {
		const transaction = createTransaction(db);

		expect(() =>
			transaction(() => {
				insert("a");
				throw new Error("boom");
			}),
		).toThrow("boom");

		expect(count()).toBe(0);
	});
});
