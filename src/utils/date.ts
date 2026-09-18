const LOCALE = "es-ES";

export const formatWallClock = (
	instant: Temporal.Instant,
	timeZone: string,
): string => {
	return instant.toZonedDateTimeISO(timeZone).toPlainDateTime().toString({
		smallestUnit: "minute",
	});
};

export const formatDay = (isoDate: string): string =>
	Temporal.PlainDate.from(isoDate).toLocaleString(LOCALE, {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
