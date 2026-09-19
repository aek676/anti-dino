import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ENV } from "varlock/env";
import { FreshaError, type FreshaModel } from "@/modules/fresha";
import type { Message } from "@/modules/telegram";
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

const failing = (
	message = "boom",
	status?: number,
	retryAfterSeconds?: number,
) => {
	let calls = 0;
	let slots: Slot[] | undefined;
	return {
		listSlots: (): Promise<Slot[] | FreshaError> => {
			calls++;
			return Promise.resolve(
				slots ?? new FreshaError(message, "http", status, retryAfterSeconds),
			);
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
	let sent: Message[];
	let edited: { chatId: number; messageId: number; message: Message }[];
	const chatId = 42;
	const bookButton = [
		[{ label: "Book on Fresha", url: ENV.FRESHA_BOOKING_URL }],
	];
	const notify = (message: Message) => {
		sent.push(message);
		return Promise.resolve(new Map([[chatId, sent.length]]));
	};
	let sentToAdmin: string[];
	const notifyAdmin = (message: Message) => {
		sentToAdmin.push(message.text);
		return Promise.resolve();
	};
	const edit = (chatId: number, messageId: number, message: Message) => {
		edited.push({ chatId, messageId, message });
		return Promise.resolve();
	};
	const sleep = () => Promise.resolve();
	let clock: Temporal.Instant;
	const now = () => clock;

	const service = (fresha: {
		listSlots: () => Promise<Slot[] | FreshaError>;
	}) =>
		createWatchdogService({
			db,
			fresha,
			notify,
			notifyAdmin,
			edit,
			now,
			sleep,
		});

	const countSlots = () =>
		db
			.query<{ n: number }, [string, string]>(
				"SELECT COUNT(*) AS n FROM slots WHERE employee_id = ? AND service_id = ?",
			)
			.get(employeeId, serviceId)?.n ?? 0;

	const countAlerts = () =>
		db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM alerts").get()?.n ??
		0;

	beforeEach(() => {
		db = openDatabase(":memory:");
		sent = [];
		sentToAdmin = [];
		edited = [];
		clock = Temporal.Instant.from("2026-09-14T10:00:00Z");
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
		expect(sent[0]).toEqual({
			text: [
				"<b>🟢 2 new slots</b>",
				"<b>Thu, Sep 17</b>\n<code>11:30</code>  <code>11:45</code>",
			].join("\n\n"),
			buttons: bookButton,
		});
		expect(countSlots()).toBe(2);

		const row = db
			.query<{ seen_at: string }, []>("SELECT seen_at FROM slots LIMIT 1")
			.get();
		expect(row?.seen_at).toBe("2026-09-14T10:00:00.000Z");
	});

	test("groups the alert by day in chronological order", async () => {
		await service(fake([slotC, slotB, slotA])).check();

		expect(sent[0]?.text).toBe(
			[
				"<b>🟢 3 new slots</b>",
				"<b>Thu, Sep 17</b>\n<code>11:30</code>  <code>11:45</code>",
				"<b>Fri, Sep 18</b>\n<code>10:00</code>",
			].join("\n\n"),
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
		expect(sent[1]?.text).toContain("<b>🟢 1 new slot</b>");
		expect(sent[1]?.text).toContain("<b>Fri, Sep 18</b>\n<code>10:00</code>");
		expect(sent[1]?.text).not.toContain("11:30");
		expect(countSlots()).toBe(3);
	});

	test("strikes a gone slot in the message that announced it", async () => {
		await service(fake([slotA, slotB])).check();

		const result = await service(fake([slotB])).check();

		expect(result).toEqual({
			ok: true,
			newSlots: [],
			goneSlots: ["2026-09-17T11:30"],
		});
		expect(edited).toHaveLength(1);
		expect(edited[0]?.chatId).toBe(chatId);
		expect(edited[0]?.messageId).toBe(1);
		expect(edited[0]?.message).toEqual({
			text: [
				"<b>🟡 1 of 2 slots left</b>",
				"<b>Thu, Sep 17</b>\n<s>11:30</s>  <code>11:45</code>",
			].join("\n\n"),
			buttons: bookButton,
		});
		expect(sent).toHaveLength(1);
	});

	test("edits every message that mentioned a gone slot", async () => {
		await service(fake([slotA])).check();
		await service(fake([slotA, slotC])).check();

		await service(fake([])).check();

		expect(edited.map((call) => call.messageId)).toEqual([1, 2]);
		expect(edited[0]?.message).toEqual({
			text: [
				"<b>⚪ No slots left from this alert</b>",
				"<b>Thu, Sep 17</b>\n<s>11:30</s>",
			].join("\n\n"),
			buttons: [],
		});
		expect(edited[1]?.message).toEqual({
			text: [
				"<b>⚪ No slots left from this alert</b>",
				"<b>Fri, Sep 18</b>\n<s>10:00</s>",
			].join("\n\n"),
			buttons: [],
		});
	});

	test("does not edit anything while every slot is still there", async () => {
		const watchdog = service(fake([slotA, slotB]));
		await watchdog.check();
		await watchdog.check();

		expect(edited).toEqual([]);
	});

	test("restores a slot that comes back", async () => {
		await service(fake([slotA, slotB])).check();
		await service(fake([slotB])).check();

		await service(fake([slotA, slotB])).check();

		expect(edited).toHaveLength(1);
		expect(sent).toHaveLength(2);
		expect(sent[1]?.text).toContain("1 new slot");
	});

	test("forgets alerts once their slot time has passed", async () => {
		const watchdog = service(fake([slotA, slotB]));
		await watchdog.check();
		expect(countAlerts()).toBe(2);

		clock = Temporal.Instant.from("2026-09-17T09:40:00Z");
		await watchdog.check();

		expect(countAlerts()).toBe(1);
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
		expect(sent[0]).toEqual({
			text: `Fresha API error (${threshold} checks in a row): HTTP 503`,
		});

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
		expect(sent[1]).toEqual({
			text: `Fresha OK again after ${threshold + 1} failed checks`,
		});
		expect(sent[2]?.text).toContain("<b>Thu, Sep 17</b>\n<code>11:30</code>");
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

	test("waits out the Retry-After of a 429 instead of guessing", async () => {
		const fresha = failing("HTTP 429", 429, 711);
		const watchdog = service(fresha);

		expect(await watchdog.check()).toEqual({ ok: false });

		clock = clock.add({ seconds: 710 });
		expect(await watchdog.check()).toEqual({ ok: false, skipped: true });
		expect(fresha.calls).toBe(1);

		fresha.recover([slotA]);
		clock = clock.add({ seconds: 1 });
		expect(await watchdog.check()).toEqual({
			ok: true,
			newSlots: ["2026-09-17T11:30"],
			goneSlots: [],
		});
		expect(fresha.calls).toBe(2);
	});

	test("tells the admin once when the rate limit starts and again when it lifts", async () => {
		const fresha = failing("HTTP 429", 429, 711);
		const watchdog = service(fresha);

		await watchdog.check();
		expect(sentToAdmin).toEqual([
			"⏸ Fresha rate limited. Checks paused until 12:11",
		]);

		clock = clock.add({ seconds: 300 });
		await watchdog.check();
		clock = clock.add({ seconds: 411 });
		await watchdog.check();
		expect(sentToAdmin).toHaveLength(1);

		fresha.recover([]);
		clock = clock.add({ seconds: 711 });
		await watchdog.check();
		expect(sentToAdmin).toEqual([
			"⏸ Fresha rate limited. Checks paused until 12:11",
			"▶️ Fresha rate limit lifted, checks resumed",
		]);
		expect(sent).toEqual([]);
	});

	test("announces the pause in checks when the 429 has no Retry-After", async () => {
		await service(failing("HTTP 429", 429)).check();

		expect(sentToAdmin).toEqual([
			"⏸ Fresha rate limited. Checks paused for 1 check",
		]);
	});

	test("keeps the admin out of it when the failure is not a rate limit", async () => {
		const fresha = failing("HTTP 503");
		const watchdog = service(fresha);

		await watchdog.check();
		fresha.recover([]);
		await watchdog.check();

		expect(sentToAdmin).toEqual([]);
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
			edit,
			notifyAdmin,
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

	test("escapes the Fresha error in the failure alert", async () => {
		const watchdog = service(failing("unexpected <html> & more"));

		for (let i = 0; i < threshold; i++) await watchdog.check();

		expect(sent[0]?.text).toContain("unexpected &lt;html&gt; &amp; more");
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
