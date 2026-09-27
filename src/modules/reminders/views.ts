import { InlineKeyboard } from "grammy";
import { formatDay } from "@/utils/date";
import { encode } from "./callback";
import { MAX_REMINDERS, type ReminderModel } from "./model";

const FIRST_HOUR = 9;
const LAST_HOUR = 21;

const NAMED_RANGES = [
	{ label: "Mañana (9–14)", from: "09:00", to: "14:00" },
	{ label: "Tarde (14–21)", from: "14:00", to: "21:00" },
	{ label: "Todo el día", from: "00:00", to: "24:00" },
] as const;

const hourTime = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export type View = { text: string; keyboard?: InlineKeyboard };

const LOCALE = "es-ES";
export const DAYS_PER_PAGE = 7;
const DAYS_PER_ROW = 4;
const HOURS_PER_ROW = 4;

const capitalize = (text: string) =>
	text.charAt(0).toUpperCase() + text.slice(1);

const WHOLE_DAY = { from: "00:00", to: "24:00" };

const isWholeDay = (
	range: Pick<ReminderModel["reminderRange"], "from" | "to">,
) => range.from === WHOLE_DAY.from && range.to === WHOLE_DAY.to;

/** "Vie, 3 oct de 16:00 a 21:00" */
export const describe = (range: ReminderModel["reminderRange"]) =>
	isWholeDay(range)
		? `${formatDay(range.day)} (todo el día)`
		: `${formatDay(range.day)} de ${range.from} a ${range.to}`;

const shortHour = (time: string) =>
	time.endsWith(":00") ? String(Number(time.slice(0, 2))) : time;

const shortDescribe = (range: ReminderModel["reminderRange"]) =>
	`${formatDay(range.day)} ${isWholeDay(range) ? "todo el día" : `${shortHour(range.from)}–${shortHour(range.to)}`}`;

const dayLabel = (day: Temporal.PlainDate, offset: number) => {
	if (offset === 0) return "Hoy";
	if (offset === 1) return "Mañana";
	return `${capitalize(day.toLocaleString(LOCALE, { weekday: "short" }))} ${day.day}`;
};

export const pageOf = (today: string, day: string) =>
	Math.floor(
		Temporal.PlainDate.from(today).until(day, { largestUnit: "days" }).days /
			DAYS_PER_PAGE,
	);

export const pageCount = (daysAhead: number) =>
	Math.ceil(daysAhead / DAYS_PER_PAGE);

export const dayPicker = (
	today: string,
	daysAhead: number,
	page: number,
	notice?: string,
): View => {
	const start = Temporal.PlainDate.from(today);
	const first = page * DAYS_PER_PAGE;
	const last = Math.min(first + DAYS_PER_PAGE, daysAhead);

	const keyboard = new InlineKeyboard();
	for (let offset = first; offset < last; offset++) {
		const day = start.add({ days: offset });
		keyboard.text(
			dayLabel(day, offset),
			encode({ kind: "day", day: day.toString() }),
		);
		if ((offset - first + 1) % DAYS_PER_ROW === 0) keyboard.row();
	}
	keyboard.row();

	if (page > 0) keyboard.text("◀", encode({ kind: "page", page: page - 1 }));
	if (page < pageCount(daysAhead) - 1)
		keyboard.text("▶", encode({ kind: "page", page: page + 1 }));
	keyboard.row().text("Cancelar", encode({ kind: "cancel" }));

	const question = "¿Qué día quieres la cita?";
	return { text: notice ? `${notice}\n\n${question}` : question, keyboard };
};

export const rangePicker = (day: string, page: number): View => {
	const keyboard = new InlineKeyboard();
	for (const range of NAMED_RANGES)
		keyboard
			.text(
				range.label,
				encode({ kind: "save", day, from: range.from, to: range.to }),
			)
			.row();
	keyboard
		.text("Otra hora", encode({ kind: "from", day }))
		.row()
		.text("◀ Cambiar día", encode({ kind: "page", page }));

	return { text: `${formatDay(day)}: ¿a qué hora?`, keyboard };
};

const hourGrid = (
	hours: number[],
	button: (hour: number) => string,
	back: string,
): InlineKeyboard => {
	const keyboard = new InlineKeyboard();
	hours.forEach((hour, index) => {
		keyboard.text(hourTime(hour), button(hour));
		if ((index + 1) % HOURS_PER_ROW === 0) keyboard.row();
	});
	return keyboard.row().text("◀", back);
};

const range = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, index) => from + index);

export const fromPicker = (day: string): View => ({
	text: `${formatDay(day)}: ¿desde qué hora?`,
	keyboard: hourGrid(
		range(FIRST_HOUR, LAST_HOUR - 1),
		(hour) => encode({ kind: "to", day, from: hourTime(hour) }),
		encode({ kind: "day", day }),
	),
});

export const toPicker = (day: string, from: string): View => {
	const fromHour = Number(from.slice(0, 2));
	const firstHour = Math.max(fromHour + 1, FIRST_HOUR + 1);
	return {
		text: `${formatDay(day)} desde las ${from}: ¿hasta qué hora?`,
		keyboard: hourGrid(
			range(firstHour, LAST_HOUR),
			(hour) => encode({ kind: "save", day, from, to: hourTime(hour) }),
			encode({ kind: "from", day }),
		),
	};
};

const MODE_QUESTION = "¿Qué quieres recibir mientras tengas avisos?";

const modeKeyboard = (source: "confirm" | "list") =>
	new InlineKeyboard()
		.text(
			"🎯 Solo mis avisos",
			encode({ kind: "mode", onlyReminders: true, source }),
		)
		.row()
		.text(
			"🔔 Todas las citas",
			encode({ kind: "mode", onlyReminders: false, source }),
		);

export const saved = (
	reminder: ReminderModel["reminder"],
	askMode: boolean,
): View => {
	const text = `✅ Te aviso si sale cita el ${describe(reminder)}.`;
	return askMode
		? { text: `${text}\n\n${MODE_QUESTION}`, keyboard: modeKeyboard("confirm") }
		: { text };
};

export const duplicate = (reminder: ReminderModel["reminder"]): View => ({
	text: `Ya tenías ese aviso: ${describe(reminder)}.`,
});

export const limitReached: View = {
	text: `Ya tienes ${MAX_REMINDERS} avisos. Quita alguno con /reminders antes de crear otro.`,
};

export const cancelled: View = { text: "Cancelado." };

export const modeSentence = (onlyReminders: boolean) =>
	onlyReminders
		? "Mientras tengas avisos, solo te escribiré cuando salga una cita que encaje."
		: "Seguirás recibiendo todas las citas nuevas; las que encajen con tus avisos llevarán 🎯.";

/** Replaces the question under a saved reminder with the chosen mode. */
export const modeChosen = (
	savedText: string,
	onlyReminders: boolean,
): View => ({
	text: [
		savedText.split("\n\n")[0],
		`${modeSentence(onlyReminders)} Puedes cambiarlo en /reminders.`,
	].join("\n\n"),
});

export const list = (
	reminders: ReminderModel["reminder"][],
	onlyReminders: boolean,
): View => {
	if (reminders.length === 0)
		return {
			text: "No tienes avisos. Usa /remind para crear uno.\n\nSin avisos recibes todas las citas nuevas.",
		};

	const keyboard = new InlineKeyboard();
	for (const reminder of reminders)
		keyboard
			.text(
				`❌ ${shortDescribe(reminder)}`,
				encode({ kind: "remove", id: reminder.id }),
			)
			.row();
	keyboard.text(
		onlyReminders ? "🔔 Recibir todas las citas" : "🎯 Recibir solo mis avisos",
		encode({ kind: "mode", onlyReminders: !onlyReminders, source: "list" }),
	);

	return {
		text: [
			"Tus avisos:",
			reminders.map((reminder) => `• ${describe(reminder)}`).join("\n"),
			modeSentence(onlyReminders),
			"Pulsa un aviso para quitarlo.",
		].join("\n\n"),
		keyboard,
	};
};
