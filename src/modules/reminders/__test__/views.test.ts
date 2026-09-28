import { describe, expect, test } from "bun:test";
import type { InlineKeyboard } from "grammy";
import * as views from "../views";
import { buttons } from "./harness";

const flat = (keyboard?: InlineKeyboard) => buttons(keyboard).flat();

describe("reminder views", () => {
	test("the first page starts with today and tomorrow and only goes forward", () => {
		const view = views.dayPicker("2026-09-26", 31, 0);
		const rows = buttons(view.keyboard);

		expect(rows[0]?.map((b) => b.text)).toEqual([
			"Hoy",
			"Mañana",
			"Lun 28",
			"Mar 29",
		]);
		expect(rows[1]?.map((b) => b.text)).toEqual(["Mié 30", "Jue 1", "Vie 2"]);
		expect(rows[0]?.[0]?.data).toBe("day:2026-09-26");
		expect(rows[2]).toEqual([{ text: "▶", data: "page:1" }]);
		expect(rows[3]).toEqual([{ text: "Cancelar", data: "cancel" }]);
	});

	test("the last page stops at the last day Fresha is checked", () => {
		const view = views.dayPicker("2026-09-26", 31, 4);
		const days = flat(view.keyboard).filter((b) => b.data?.startsWith("day:"));

		expect(days.map((b) => b.data)).toEqual([
			"day:2026-10-24",
			"day:2026-10-25",
			"day:2026-10-26",
		]);
		expect(flat(view.keyboard).map((b) => b.text)).not.toContain("▶");
		expect(flat(view.keyboard).map((b) => b.text)).toContain("◀");
	});

	test("the range picker offers named ranges, another hour and going back", () => {
		const view = views.rangePicker("2026-10-03");

		expect(view.text).toBe("Sáb, 3 oct: ¿a qué hora?");
		expect(flat(view.keyboard).map((b) => b.data)).toEqual([
			"range:09:00-14:00",
			"range:14:00-21:00",
			"range:00:00-24:00",
			"other",
			"back",
		]);
	});

	test("the end hours start one hour after the start", () => {
		const view = views.toPicker("2026-10-03", "18:00");
		const hours = flat(view.keyboard).filter((b) => b.data?.startsWith("to:"));

		expect(hours.map((b) => b.text)).toEqual(["19:00", "20:00", "21:00"]);
		expect(hours[0]?.data).toBe("to:19:00");
	});

	test("the start hours go from 9 to 20", () => {
		const hours = flat(views.fromPicker("2026-10-03").keyboard).filter((b) =>
			b.data?.startsWith("from:"),
		);
		expect(hours.map((b) => b.text)).toEqual(
			Array.from(
				{ length: 12 },
				(_, i) => `${String(9 + i).padStart(2, "0")}:00`,
			),
		);
	});

	test("a saved reminder asks for the mode only when asked to", () => {
		const reminder = {
			id: 1,
			chatId: 10,
			day: "2026-10-03",
			from: "16:00",
			to: "21:00",
		};

		expect(views.saved(reminder, false)).toEqual({
			text: "✅ Te aviso si sale cita el Sáb, 3 oct de 16:00 a 21:00.",
		});
		const asking = views.saved(reminder, true);
		expect(asking.text).toContain("¿Qué quieres recibir");
		expect(flat(asking.keyboard).map((b) => b.data)).toEqual([
			"rem:mode:only:confirm",
			"rem:mode:all:confirm",
		]);
	});

	test("the list has a remove button per reminder and a mode switch", () => {
		const view = views.list(
			[
				{ id: 1, chatId: 10, day: "2026-10-03", from: "16:00", to: "21:00" },
				{ id: 2, chatId: 10, day: "2026-10-04", from: "00:00", to: "24:00" },
			],
			true,
		);

		expect(view.text).toContain("• Sáb, 3 oct de 16:00 a 21:00");
		expect(view.text).toContain("• Dom, 4 oct (todo el día)");
		expect(flat(view.keyboard)).toEqual([
			{ text: "❌ Sáb, 3 oct 16–21", data: "rem:remove:1" },
			{ text: "❌ Dom, 4 oct todo el día", data: "rem:remove:2" },
			{ text: "🔔 Recibir todas las citas", data: "rem:mode:all:list" },
		]);
	});

	test("an empty list explains how to create one", () => {
		expect(views.list([], false).text).toContain("/remind");
		expect(views.list([], false).keyboard).toBeUndefined();
	});
});
