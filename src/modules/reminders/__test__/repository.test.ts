import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSubscribersRepository } from "@/modules/telegram";
import { type Db, openDatabase } from "@/utils/db";
import {
	createRemindersRepository,
	type RemindersRepository,
} from "../repository";

const TODAY = "2026-09-26";
const friday = { day: "2026-10-02", from: "16:00", to: "21:00" };

describe("reminders repository", () => {
	let db: Db;
	let repo: RemindersRepository;

	beforeEach(() => {
		db = openDatabase(":memory:");
		repo = createRemindersRepository(db);
	});
	afterEach(() => {
		db.close();
	});

	test("finds a reminder by its exact range", () => {
		const inserted = repo.insert(10, friday);

		expect(repo.find(10, friday)).toEqual(inserted);
		expect(repo.find(10, { ...friday, to: "20:00" })).toBeNull();
		expect(repo.find(20, friday)).toBeNull();
	});

	test("counts only the reminders from today on", () => {
		repo.insert(10, { ...friday, day: "2026-09-25" });
		repo.insert(10, { ...friday, day: TODAY });
		repo.insert(10, friday);
		repo.insert(20, friday);

		expect(repo.countActive(10, TODAY)).toBe(2);
	});

	test("only removes a reminder of the same chat", () => {
		const reminder = repo.insert(10, friday);

		expect(repo.remove(20, reminder.id)).toBe(false);
		expect(repo.remove(10, reminder.id)).toBe(true);
		expect(repo.listByChat(10, TODAY)).toEqual([]);
	});

	test("deletes the reminders of past days", () => {
		repo.insert(10, { ...friday, day: "2026-09-25" });
		repo.insert(10, { ...friday, day: TODAY });

		repo.deleteBefore(TODAY);

		expect(repo.listByChat(10, "2000-01-01").map((r) => r.day)).toEqual([
			TODAY,
		]);
	});

	test("groups the audience by chat with its delivery mode", () => {
		const subscribers = createSubscribersRepository(db);
		subscribers.register(10);
		subscribers.register(20);
		subscribers.setOnlyReminders(10, true);
		repo.insert(10, friday);
		repo.insert(10, { ...friday, from: "09:00", to: "14:00" });
		repo.insert(20, friday);
		repo.insert(30, { ...friday, day: "2026-09-25" });

		const audience = repo.listAudience(TODAY);

		expect([...audience.keys()]).toEqual([10, 20]);
		expect(audience.get(10)?.onlyReminders).toBe(true);
		expect(audience.get(10)?.reminders.map((r) => r.from)).toEqual([
			"09:00",
			"16:00",
		]);
		expect(audience.get(20)?.onlyReminders).toBe(false);
	});
});
