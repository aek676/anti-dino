import { t, type UnwrapSchema } from "elysia";

export const MAX_REMINDERS = 10;

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
