import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ENV } from "varlock/env";
import type { Message } from "@/modules/telegram";
import { type Db, openDatabase } from "@/utils/db";
import { watchTarget } from "../model";
import { createSlotsRepository } from "../repository";
import { createSlotsService } from "../service";

const SEEN_AT = "2026-09-14T09:00:00.000Z";
const MESSAGE_ID = 900;

describe("slots service", () => {
	let db: Db;
	let sent: { chatId: number; message: Message }[];
	let clock: Temporal.Instant;
	let delivered: boolean;
	const target = watchTarget();
	const bookButton = [
		[{ label: "Book on Fresha", url: ENV.FRESHA_BOOKING_URL }],
	];

	const service = () =>
		createSlotsService({
			db,
			now: () => clock,
			send: (chatId, message) => {
				sent.push({ chatId, message });
				return Promise.resolve(delivered ? MESSAGE_ID : undefined);
			},
		});

	const seed = (startTimes: string[]) =>
		createSlotsRepository(db).insertSlots(target, startTimes, SEEN_AT);

	beforeEach(() => {
		db = openDatabase(":memory:");
		sent = [];
		delivered = true;
		clock = Temporal.Instant.from("2026-09-14T10:00:00Z");
	});
	afterEach(() => {
		db.close();
	});

	test("sendCurrent sends the slots known right now to one chat", async () => {
		seed(["2026-09-18T10:00", "2026-09-17T11:30"]);

		await service().sendCurrent(7);

		expect(sent).toEqual([
			{
				chatId: 7,
				message: {
					text: [
						"<b>🟢 2 slots available</b>",
						"<b>Thu, Sep 17</b>\n<code>11:30</code>",
						"<b>Fri, Sep 18</b>\n<code>10:00</code>",
					].join("\n\n"),
					buttons: bookButton,
				},
			},
		]);
	});

	test("sendCurrent records its message so it is updated when a slot goes", async () => {
		seed(["2026-09-17T11:30", "2026-09-17T11:45"]);

		await service().sendCurrent(7);

		const repo = createSlotsRepository(db);
		expect(repo.listAlertMessages(target, ["2026-09-17T11:30"])).toEqual([
			{ chatId: 7, messageId: MESSAGE_ID },
		]);
		expect(repo.listAlertStartTimes(7, MESSAGE_ID)).toEqual([
			"2026-09-17T11:30",
			"2026-09-17T11:45",
		]);
	});

	test("sendCurrent records nothing when the message did not go out", async () => {
		seed(["2026-09-17T11:30"]);
		delivered = false;

		await service().sendCurrent(7);

		expect(
			createSlotsRepository(db).listAlertMessages(target, ["2026-09-17T11:30"]),
		).toEqual([]);
	});

	test("listCurrent leaves out the slots that already started", () => {
		seed(["2026-09-17T11:30", "2026-09-18T10:00"]);
		clock = Temporal.Instant.from("2026-09-17T20:00:00Z");

		expect(service().listCurrent()).toEqual(["2026-09-18T10:00"]);
	});

	test("sendCurrent says so when there is nothing to book", async () => {
		await service().sendCurrent(7);

		expect(sent).toEqual([
			{
				chatId: 7,
				message: {
					text: "No slots available right now. I'll message you as soon as one opens up.",
				},
			},
		]);
	});
});
