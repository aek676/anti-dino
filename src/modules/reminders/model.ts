import { t, type UnwrapSchema } from "elysia";

export const MAX_REMINDERS = 10;

/** The hour grids run from FIRST_HOUR to LAST_HOUR, the salon's opening hours. */
export const FIRST_HOUR = 9;
export const LAST_HOUR = 21;

export const NAMED_RANGES = [
	{ label: "Mañana (9–14)", from: "09:00", to: "14:00" },
	{ label: "Tarde (14–21)", from: "14:00", to: "21:00" },
	{ label: "Todo el día", from: "00:00", to: "24:00" },
] as const;

const reminder = t.Object({
	id: t.Number(),
	chatId: t.Number(),
	day: t.String(),
	from: t.String(),
	to: t.String(),
});

export const ReminderModel = {
	reminder,
	reminderRange: t.Pick(reminder, ["day", "from", "to"]),
	audience: t.Object({
		reminders: t.Array(reminder),
		onlyReminders: t.Boolean(),
	}),
	addResult: t.Union([
		t.Object({
			status: t.Union([t.Literal("added"), t.Literal("duplicate")]),
			reminder,
		}),
		t.Object({ status: t.Literal("limit") }),
	]),
};

export type ReminderModel = {
	[K in keyof typeof ReminderModel]: UnwrapSchema<(typeof ReminderModel)[K]>;
};
