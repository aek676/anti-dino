import { describe, expect, test } from "bun:test";
import { book } from "@/modules/book";
import { FreshaError } from "@/modules/fresha";

describe("GET /book/:slot", () => {
	const request = (slot: string, fails = false) =>
		book({
			fresha: {
				prepareBooking: () =>
					Promise.resolve(
						fails
							? new FreshaError("HTTP 503", "http", 503)
							: { cartId: "cart-1", selected: true },
					),
			},
			now: () => Temporal.Instant.from("2026-09-14T10:00:00Z"),
		}).handle(new Request(`http://localhost/book/${slot}`));

	test("redirects to the prepared cart", async () => {
		const res = await request("2026-09-17T11:30");

		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe(
			"https://www.fresha.com/a/test-salon/booking?cartId=cart-1",
		);
	});

	test("redirects to the booking page when Fresha fails", async () => {
		const res = await request("2026-09-17T11:30", true);

		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe(
			"https://www.fresha.com/a/test-salon/booking?offerItems=test&employeeId=1234&preferredDate=2026-09-17",
		);
	});
});
