import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ENV } from "varlock/env";
import { FreshaError, type FreshaModel } from "@/modules/fresha";
import { type Db, openDatabase } from "@/utils/db";
import { createWatchdogService, retry } from "../service";

type Slot = FreshaModel["slot"];

const employeeId = String(ENV.FRESHA_EMPLOYEE_ID);
const serviceId = ENV.FRESHA_SERVICE_ID;

const slotA: Slot = { date: "2026-09-17", time: "11:30" };
const slotB: Slot = { date: "2026-09-17", time: "11:45" };
const slotC: Slot = { date: "2026-09-18", time: "10:00" };

const fake = (slots: Slot[]) => {
	let calls = 0;
	return {
		listSlots: () => {
			calls++;
			return Promise.resolve(slots);
		},
		get calls() {
			return calls;
		},
	};
};

const failing = (message = "boom", status?: number) => {
	let calls = 0;
	let slots: Slot[] | undefined;
	return {
		listSlots: (): Promise<Slot[] | FreshaError> => {
			calls++;
			return Promise.resolve(slots ?? new FreshaError(message, "http", status));
		},
		recover: (next: Slot[]) => {
			slots = next;
		},
		get calls() {
			return calls;
		},
	};
};

describe("retry", () => {
	let waits: number[];
	const sleep = (ms: number) => {
		waits.push(ms);
		return Promise.resolve();
	};

	beforeEach(() => {
		waits = [];
	});

	test("returns the first success and backs off between attempts", async () => {
		let calls = 0;
		const fn = () => {
			calls++;
			return Promise.resolve(
				calls < 3 ? new FreshaError(`fail ${calls}`, "http") : "ok",
			);
		};

		const result = await retry(fn, 5, sleep);

		expect(result).toBe("ok");
		expect(calls).toBe(3);
		expect(waits).toEqual([2000, 4000]);
	});

	test("returns the last error and does not sleep after the last attempt", async () => {
		let calls = 0;
		const fn = () => {
			calls++;
			return Promise.resolve(new FreshaError(`fail ${calls}`, "http"));
		};

		const result = await retry(fn, 3, sleep);

		expect(result).toBeInstanceOf(FreshaError);
		expect((result as FreshaError).message).toBe("fail 3");
		expect(calls).toBe(3);
		expect(waits).toHaveLength(2);
	});

	test("gives up at once on a 429", async () => {
		let calls = 0;
		const fn = () => {
			calls++;
			return Promise.resolve(new FreshaError("HTTP 429", "http", 429));
		};

		const result = await retry(fn, 5, sleep);

		expect(result).toBeInstanceOf(FreshaError);
		expect(calls).toBe(1);
		expect(waits).toEqual([]);
	});
});

describe("check", () => {
	let db: Db;
	let sent: string[];
	const notify = (text: string) => {
		sent.push(text);
		return Promise.resolve();
	};
	const sleep = () => Promise.resolve();
	const now = () => new Date("2026-09-14T10:00:00Z");

	const service = (fresha: {
		listSlots: () => Promise<Slot[] | FreshaError>;
	}) => createWatchdogService({ db, fresha, notify, now, sleep });

	const countSlots = () =>
		db
			.query<{ n: number }, [string, string]>(
				"SELECT COUNT(*) AS n FROM slots WHERE employee_id = ? AND service_id = ?",
			)
			.get(employeeId, serviceId)?.n ?? 0;

	beforeEach(() => {
		db = openDatabase(":memory:");
		sent = [];
	});
	afterEach(() => {
		db.close();
	});

	test("first run persists and notifies every slot", async () => {
		const result = await service(fake([slotA, slotB])).check();

		expect(result).toEqual({
			ok: true,
			newSlots: ["2026-09-17T11:30", "2026-09-17T11:45"],
			goneSlots: [],
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]).toBe(
			[
				"2 new slot(s):",
				"jue, 17 sept: 11:30, 11:45",
				ENV.FRESHA_BOOKING_URL,
			].join("\n"),
		);
		expect(countSlots()).toBe(2);

		const row = db
			.query<{ seen_at: string }, []>("SELECT seen_at FROM slots LIMIT 1")
			.get();
		expect(row?.seen_at).toBe("2026-09-14T10:00:00.000Z");
	});

	test("groups the alert by day in chronological order", async () => {
		await service(fake([slotC, slotB, slotA])).check();

		expect(sent[0]).toBe(
			[
				"3 new slot(s):",
				"jue, 17 sept: 11:30, 11:45",
				"vie, 18 sept: 10:00",
				ENV.FRESHA_BOOKING_URL,
			].join("\n"),
		);
	});

	test("second run with the same slots is silent", async () => {
		const watchdog = service(fake([slotA, slotB]));
		await watchdog.check();

		const result = await watchdog.check();

		expect(result).toEqual({ ok: true, newSlots: [], goneSlots: [] });
		expect(sent).toHaveLength(1);
		expect(countSlots()).toBe(2);
	});

	test("only reports slots not seen before", async () => {
		await service(fake([slotA, slotB])).check();

		const result = await service(fake([slotA, slotB, slotC])).check();

		expect(result).toEqual({
			ok: true,
			newSlots: ["2026-09-18T10:00"],
			goneSlots: [],
		});
		expect(sent).toHaveLength(2);
		expect(sent[1]).toContain("vie, 18 sept: 10:00");
		expect(sent[1]).not.toContain("11:30");
		expect(countSlots()).toBe(3);
	});

	test("collapses duplicated slots", async () => {
		const result = await service(fake([slotA, slotA])).check();

		expect(result).toEqual({
			ok: true,
			newSlots: ["2026-09-17T11:30"],
			goneSlots: [],
		});
		expect(countSlots()).toBe(1);
	});

	const threshold = ENV.FAILURE_ALERT_THRESHOLD;

	test("retries a transient failure a few times and stays silent", async () => {
		const fresha = failing("HTTP 503");

		const result = await service(fresha).check();

		expect(result).toEqual({ ok: false });
		expect(fresha.calls).toBe(3);
		expect(sent).toEqual([]);
		expect(countSlots()).toBe(0);
	});

	test("alerts once when failures reach the threshold, then on recovery", async () => {
		const fresha = failing("HTTP 503");
		const watchdog = service(fresha);

		for (let i = 1; i < threshold; i++) await watchdog.check();
		expect(sent).toEqual([]);

		await watchdog.check();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toBe(
			`Fresha API error (${threshold} checks in a row): HTTP 503`,
		);

		await watchdog.check();
		expect(sent).toHaveLength(1);

		fresha.recover([slotA]);
		const result = await watchdog.check();

		expect(result).toEqual({
			ok: true,
			newSlots: ["2026-09-17T11:30"],
			goneSlots: [],
		});
		expect(sent).toHaveLength(3);
		expect(sent[1]).toBe(
			`Fresha OK again after ${threshold + 1} failed checks`,
		);
		expect(sent[2]).toContain("jue, 17 sept: 11:30");
	});

	test("a short failure streak recovers without any message", async () => {
		const fresha = failing("HTTP 503");
		const watchdog = service(fresha);

		await watchdog.check();
		fresha.recover([]);
		await watchdog.check();

		expect(sent).toEqual([]);
	});

	test("backs off across ticks after a 429", async () => {
		const fresha = failing("HTTP 429", 429);
		const watchdog = service(fresha);

		expect(await watchdog.check()).toEqual({ ok: false });
		expect(fresha.calls).toBe(1);

		expect(await watchdog.check()).toEqual({ ok: false, skipped: true });
		expect(fresha.calls).toBe(1);

		expect(await watchdog.check()).toEqual({ ok: false });
		expect(fresha.calls).toBe(2);
		expect(await watchdog.check()).toEqual({ ok: false, skipped: true });
		expect(await watchdog.check()).toEqual({ ok: false, skipped: true });
		expect(fresha.calls).toBe(2);

		fresha.recover([slotA]);
		expect(await watchdog.check()).toEqual({
			ok: true,
			newSlots: ["2026-09-17T11:30"],
			goneSlots: [],
		});
		expect(sent).toHaveLength(1);
	});

	test("never skips more than six ticks in a row", async () => {
		const fresha = failing("HTTP 429", 429);
		const watchdog = service(fresha);
		const skippedPerRound: number[] = [];

		await watchdog.check();
		for (let round = 0; round < 8; round++) {
			let skipped = 0;
			let result = await watchdog.check();
			while (!result.ok && result.skipped) {
				skipped++;
				result = await watchdog.check();
			}
			skippedPerRound.push(skipped);
		}

		expect(skippedPerRound).toEqual([1, 2, 3, 4, 5, 6, 6, 6]);
	});

	test("does not persist when notify fails, so the next run alerts again", async () => {
		const fresha = fake([slotA]);
		const broken = createWatchdogService({
			db,
			fresha,
			now,
			sleep,
			notify: () => Promise.reject(new Error("telegram down")),
		});

		expect(broken.check()).rejects.toThrow("telegram down");
		expect(countSlots()).toBe(0);

		const result = await service(fresha).check();

		expect(result).toEqual({
			ok: true,
			newSlots: ["2026-09-17T11:30"],
			goneSlots: [],
		});
		expect(sent).toHaveLength(1);
		expect(countSlots()).toBe(1);
	});

	test("forgets a slot that disappears", async () => {
		await service(fake([slotA, slotB])).check();

		const result = await service(fake([slotA])).check();

		expect(result).toEqual({
			ok: true,
			newSlots: [],
			goneSlots: ["2026-09-17T11:45"],
		});
		expect(sent).toHaveLength(1);
		expect(countSlots()).toBe(1);
	});

	test("reports a slot again when it comes back", async () => {
		await service(fake([slotA, slotB])).check();
		await service(fake([slotA])).check();

		const result = await service(fake([slotA, slotB])).check();

		expect(result).toEqual({
			ok: true,
			newSlots: ["2026-09-17T11:45"],
			goneSlots: [],
		});
		expect(sent).toHaveLength(2);
		expect(countSlots()).toBe(2);
	});

	test("keeps the table untouched when Fresha fails", async () => {
		await service(fake([slotA])).check();

		const result = await service(failing()).check();

		expect(result).toEqual({ ok: false });
		expect(countSlots()).toBe(1);
	});

	test("empties the table when nothing is free", async () => {
		await service(fake([slotA, slotB])).check();

		const result = await service(fake([])).check();

		expect(result).toEqual({
			ok: true,
			newSlots: [],
			goneSlots: ["2026-09-17T11:30", "2026-09-17T11:45"],
		});
		expect(sent).toHaveLength(1);
		expect(countSlots()).toBe(0);
	});
});
