import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Db, openDatabase } from "@/utils/db";
import {
	createConversationsRepository,
	createSubscribersRepository,
	type SubscribersRepository,
} from "../repository";

describe("subscribers repository", () => {
	let db: Db;
	let repo: SubscribersRepository;

	beforeEach(() => {
		db = openDatabase(":memory:");
		repo = createSubscribersRepository(db);
	});
	afterEach(() => {
		db.close();
	});

	test("remembers whether a chat wants only its reminders, null until chosen", () => {
		repo.register(10);

		expect(repo.getOnlyReminders(10)).toBeNull();
		repo.setOnlyReminders(10, true);
		expect(repo.getOnlyReminders(10)).toBe(true);
		repo.setOnlyReminders(10, false);
		expect(repo.getOnlyReminders(10)).toBe(false);
	});

	test("choosing the mode does not turn the alerts back on", () => {
		repo.register(10);
		repo.unsubscribe(10);

		repo.setOnlyReminders(10, true);

		expect(repo.listSubscribers()).toEqual([]);
	});

	test("choosing the mode registers a chat that never started", () => {
		repo.setOnlyReminders(10, false);

		expect(repo.getOnlyReminders(10)).toBe(false);
		expect(repo.listSubscribers()).toEqual([10]);
	});
});

type State = { remind: { step: string; day?: string }[] };
const VERSION: [0, number] = [0, 1];

describe("conversations repository", () => {
	let db: Db;

	beforeEach(() => {
		db = openDatabase(":memory:");
	});
	afterEach(() => {
		db.close();
	});

	test("stores, overwrites and deletes a chat's state", async () => {
		const storage = createConversationsRepository<State>(db);
		const state = { version: VERSION, state: { remind: [{ step: "day" }] } };

		expect(await storage.read("10")).toBeUndefined();

		await storage.write("10", state);
		expect(await storage.read("10")).toEqual(state);

		const next = {
			version: VERSION,
			state: { remind: [{ step: "range", day: "2026-10-02" }] },
		};
		await storage.write("10", next);
		expect(await storage.read("10")).toEqual(next);
		expect(await storage.read("11")).toBeUndefined();

		await storage.delete("10");
		expect(await storage.read("10")).toBeUndefined();
	});
});
