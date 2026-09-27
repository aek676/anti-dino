import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Db, openDatabase } from "@/utils/db";
import {
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
