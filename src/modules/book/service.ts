import { FreshaError, type FreshaService } from "@/modules/fresha";
import { formatWallClock } from "@/utils/date";
import { log } from "@/utils/logger";
import { type BookOutcome, bookingPageUrl, parseSlot } from "./model";

export type BookConfig = {
	locationId: string;
	locationSlug: string;
	serviceId: string;
	employeeId: number;
	timeZone: string;
};

export type BookDeps = {
	fresha: Pick<FreshaService, "prepareBooking">;
	config: BookConfig;
	now?: () => Temporal.Instant;
};

export type BookResult = { url: string; outcome: BookOutcome };

export const createBookService = (deps: BookDeps) => {
	const { config } = deps;
	const pageUrl = (query: Record<string, string>) =>
		bookingPageUrl(config.locationSlug, query);

	// Lands on the services screen; only used when no cart could be prepared.
	const fallbackUrl = (date?: string) =>
		pageUrl({
			offerItems: config.serviceId,
			employeeId: String(config.employeeId),
			...(date && { preferredDate: date }),
		});

	const lookup = async (
		raw: string,
	): Promise<BookResult & { error?: FreshaError }> => {
		const slot = parseSlot(raw);
		const salonNow = formatWallClock(
			(deps.now ?? Temporal.Now.instant)(),
			config.timeZone,
		);
		if (!slot || raw < salonNow)
			return { url: fallbackUrl(), outcome: "invalid" };

		const booking = await deps.fresha.prepareBooking(
			config.locationId,
			config.serviceId,
			config.employeeId,
			slot,
		);
		if (booking instanceof FreshaError)
			return { url: fallbackUrl(slot.date), outcome: "error", error: booking };

		return {
			url: pageUrl({ cartId: booking.cartId }),
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
