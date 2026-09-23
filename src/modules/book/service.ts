import { ENV } from "varlock/env";
import { FreshaError, type FreshaService } from "@/modules/fresha";
import { formatWallClock } from "@/utils/date";
import { log } from "@/utils/logger";
import { type BookOutcome, bookingPageUrl, parseSlot } from "./model";

export type BookDeps = {
	fresha: Pick<FreshaService, "prepareBooking">;
	now?: () => Temporal.Instant;
};

export type BookResult = { url: string; outcome: BookOutcome };

export const createBookService = (deps: BookDeps) => {
	// Lands on the services screen; only used when no cart could be prepared.
	const fallbackUrl = (date?: string) =>
		bookingPageUrl({
			offerItems: ENV.FRESHA_SERVICE_ID,
			employeeId: String(ENV.FRESHA_EMPLOYEE_ID),
			...(date && { preferredDate: date }),
		});

	const lookup = async (
		raw: string,
	): Promise<BookResult & { error?: FreshaError }> => {
		const slot = parseSlot(raw);
		const salonNow = formatWallClock(
			(deps.now ?? Temporal.Now.instant)(),
			ENV.SALON_TIME_ZONE,
		);
		if (!slot || raw < salonNow)
			return { url: fallbackUrl(), outcome: "invalid" };

		const booking = await deps.fresha.prepareBooking(
			String(ENV.FRESHA_LOCATION_ID),
			ENV.FRESHA_SERVICE_ID,
			ENV.FRESHA_EMPLOYEE_ID,
			slot,
		);
		if (booking instanceof FreshaError)
			return { url: fallbackUrl(slot.date), outcome: "error", error: booking };

		return {
			url: bookingPageUrl({ cartId: booking.cartId }),
			outcome: booking.selected ? "slot" : "day",
		};
	};

	const resolve = async (raw: string): Promise<BookResult> => {
		const startedAt = performance.now();
		const { url, outcome, error } = await lookup(raw);
		log.info(
			{
				slot: raw,
				outcome,
				err: error?.message,
				durationMs: Math.round(performance.now() - startedAt),
			},
			"book click",
		);
		return { url, outcome };
	};

	return { resolve };
};
