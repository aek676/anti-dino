const LOCALE = "es-ES";

export const formatDay = (isoDate: string): string =>
	Temporal.PlainDate.from(isoDate).toLocaleString(LOCALE, {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
