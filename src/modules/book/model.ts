import { ENV } from "varlock/env";
import type { FreshaModel } from "@/modules/fresha";

const SLOT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(([01]\d|2[0-3]):[0-5]\d)$/;

export const parseSlot = (raw: string): FreshaModel["slot"] | null => {
	const match = SLOT_PATTERN.exec(raw);
	if (!match) return null;
	const [, date = "", time = ""] = match;
	try {
		Temporal.PlainDate.from(date, { overflow: "reject" });
	} catch {
		return null;
	}
	return { date, time };
};

export type BookOutcome = "slot" | "day" | "invalid" | "error";

export const bookingPageUrl = (query: Record<string, string>): string =>
	`https://www.fresha.com/a/${ENV.FRESHA_LOCATION_SLUG}/booking?${new URLSearchParams(query)}`;
