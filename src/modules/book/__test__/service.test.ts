import { beforeEach, describe, expect, test } from "bun:test";
import { type Booking, FreshaError, type FreshaModel } from "@/modules/fresha";
import { parseSlot } from "../model";
import { createBookService } from "../service";

const PAGE = "https://www.fresha.com/a/test-salon/booking";

const fallback = (date?: string) =>
	`${PAGE}?offerItems=test&employeeId=1234${date ? `&preferredDate=${date}` : ""}`;

describe("parseSlot", () => {
	test("accepts a start time and splits it", () => {
		expect(parseSlot("2026-09-17T11:30")).toEqual({
			date: "2026-09-17",
			time: "11:30",
		});
	});

	test.each(["2026-09-17", "2026-09-17T25:00", "2026-02-30T10:00", "x"])(
		"rejects %s",
		(raw) => {
			expect(parseSlot(raw)).toBeNull();
		},
	);
});

describe("book service", () => {
	let clock: Temporal.Instant;
	let asked: FreshaModel["slot"][];
	let booking: Booking | FreshaError;

	const service = () =>
		createBookService({
			fresha: {
				prepareBooking: (_slug, _variant, _employee, slot) => {
					asked.push(slot);
					return Promise.resolve(booking);
				},
			},
			config: {
				locationId: "1",
				locationSlug: "test-salon",
				serviceId: "test",
				employeeId: 1234,
				timeZone: "Europe/Madrid",
			},
			now: () => clock,
		});

	beforeEach(() => {
		clock = Temporal.Instant.from("2026-09-14T10:00:00Z");
		asked = [];
		booking = { cartId: "cart-1", selected: true };
	});

	test("sends the user to the cart with the hour selected", async () => {
		const result = await service().resolve("2026-09-17T11:30");

		expect(result).toEqual({ url: `${PAGE}?cartId=cart-1`, outcome: "slot" });
		expect(asked).toEqual([{ date: "2026-09-17", time: "11:30" }]);
	});

	test("sends the user to the day when Fresha no longer offers the hour", async () => {
		booking = { cartId: "cart-1", selected: false };

		const result = await service().resolve("2026-09-17T11:30");

		expect(result).toEqual({ url: `${PAGE}?cartId=cart-1`, outcome: "day" });
	});

	test("falls back to the booking page when Fresha fails", async () => {
		booking = new FreshaError("HTTP 429", "http", 429, 711);

		const result = await service().resolve("2026-09-17T11:30");

		expect(result).toEqual({ url: fallback("2026-09-17"), outcome: "error" });
	});

	test("falls back without asking Fresha when the slot already started", async () => {
		clock = Temporal.Instant.from("2026-09-17T09:31:00Z");

		const result = await service().resolve("2026-09-17T11:30");

		expect(result).toEqual({ url: fallback(), outcome: "invalid" });
		expect(asked).toEqual([]);
	});

	test("falls back without asking Fresha when the slot makes no sense", async () => {
		const result = await service().resolve("tomorrow");

		expect(result).toEqual({ url: fallback(), outcome: "invalid" });
		expect(asked).toEqual([]);
	});
});
