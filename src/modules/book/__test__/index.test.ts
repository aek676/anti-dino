import { describe, expect, test } from "bun:test";
import { book } from "@/modules/book";

const CART = "https://www.fresha.com/a/test-salon/booking?cartId=cart-1";
const IPHONE =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

describe("GET /book/:slot", () => {
	const request = (userAgent?: string) =>
		book({
			fresha: {
				prepareBooking: () =>
					Promise.resolve({ cartId: "cart-1", selected: true }),
			},
			config: {
				locationId: "1",
				locationSlug: "test-salon",
				serviceId: "test",
				employeeId: 1234,
				timeZone: "Europe/Madrid",
			},
			now: () => Temporal.Instant.from("2026-09-14T10:00:00Z"),
		}).handle(
			new Request("http://localhost/book/2026-09-17T11:30", {
				headers: userAgent ? { "user-agent": userAgent } : {},
			}),
		);

	test("redirects to the cart", async () => {
		const res = await request();

		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe(CART);
	});

	test("gives iPhones a page with a link to tap, so the Fresha app opens", async () => {
		const res = await request(IPHONE);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toStartWith("text/html");
		expect(await res.text()).toContain(`href="${CART.replace("&", "&amp;")}"`);
	});
});
