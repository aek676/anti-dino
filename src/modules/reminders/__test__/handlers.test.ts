import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Bot, Context, InlineKeyboard } from "grammy";
import {
	createSubscribersRepository,
	type SubscribersRepository,
} from "@/modules/telegram";
import { createTransaction, type Db, openDatabase } from "@/utils/db";
import { type Callback, encode } from "../callback";
import { registerReminders } from "../handlers";
import { MAX_REMINDERS } from "../model";
import {
	createRemindersRepository,
	type RemindersRepository,
} from "../repository";
import { createRemindersService } from "../service";

type Handler = (ctx: Context) => unknown;
type Shown = { text: string; keyboard?: InlineKeyboard };

const CHAT = 10;

const fakeBot = () => {
	const commands = new Map<string, Handler>();
	let callbacks: Handler | undefined;
	const bot = {
		command: (name: string, handler: Handler) => {
			commands.set(name, handler);
		},
		callbackQuery: (_trigger: RegExp, handler: Handler) => {
			callbacks = handler;
		},
	} as unknown as Bot;
	return {
		bot,
		command: (name: string, ctx: Context) => commands.get(name)?.(ctx),
		tap: (ctx: Context) => callbacks?.(ctx),
	};
};

const fakeCtx = (data?: string, messageText = "") => {
	const replies: Shown[] = [];
	const edits: Shown[] = [];
	const answers: (string | undefined)[] = [];
	const ctx = {
		chatId: CHAT,
		callbackQuery: data ? { data, message: { text: messageText } } : undefined,
		reply: (text: string, options?: { reply_markup?: InlineKeyboard }) => {
			replies.push({ text, keyboard: options?.reply_markup });
			return Promise.resolve();
		},
		editMessageText: (
			text: string,
			options?: { reply_markup?: InlineKeyboard },
		) => {
			edits.push({ text, keyboard: options?.reply_markup });
			return Promise.resolve();
		},
		answerCallbackQuery: (options?: { text?: string }) => {
			answers.push(options?.text);
			return Promise.resolve();
		},
	} as unknown as Context;
	return { ctx, replies, edits, answers };
};

describe("reminder handlers", () => {
	let db: Db;
	let repo: RemindersRepository;
	let subscribers: SubscribersRepository;
	let matching: { chatId: number; hits: string[] }[];
	const openSlots = [
		"2026-10-02T12:00",
		"2026-10-02T17:30",
		"2026-10-03T17:30",
	];

	const setup = () => {
		const fake = fakeBot();
		registerReminders(
			fake.bot,
			createRemindersService({
				repo,
				subscribers,
				sendMatching: (chatId, isMatch) => {
					matching.push({ chatId, hits: openSlots.filter(isMatch) });
					return Promise.resolve();
				},
				transaction: createTransaction(db),
				config: { timeZone: "Europe/Madrid", daysAhead: 31 },
				now: () => Temporal.Instant.from("2026-09-26T10:00:00Z"),
			}),
		);
		return {
			...fake,
			press: async (callback: Callback | string, messageText?: string) => {
				const data = typeof callback === "string" ? callback : encode(callback);
				const context = fakeCtx(data, messageText);
				await fake.tap(context.ctx);
				return context;
			},
		};
	};

	beforeEach(() => {
		db = openDatabase(":memory:");
		repo = createRemindersRepository(db);
		subscribers = createSubscribersRepository(db);
		matching = [];
	});
	afterEach(() => {
		db.close();
	});

	test("/remind starts with the day picker", async () => {
		const { command } = setup();
		const { ctx, replies } = fakeCtx();

		await command("remind", ctx);

		expect(replies[0]?.text).toBe("¿Qué día quieres la cita?");
		expect(replies[0]?.keyboard?.inline_keyboard[0]?.[0]?.text).toBe("Hoy");
	});

	test("another hour walks through start and end and saves the reminder", async () => {
		const { press } = setup();
		const day = "2026-10-02";

		expect((await press({ kind: "day", day })).edits[0]?.text).toBe(
			"Vie, 2 oct: ¿a qué hora?",
		);
		expect((await press({ kind: "from", day })).edits[0]?.text).toBe(
			"Vie, 2 oct: ¿desde qué hora?",
		);
		expect(
			(await press({ kind: "to", day, from: "17:00" })).edits[0]?.text,
		).toBe("Vie, 2 oct desde las 17:00: ¿hasta qué hora?");

		const saved = await press({
			kind: "save",
			day,
			from: "17:00",
			to: "19:00",
		});

		expect(saved.edits[0]?.text).toStartWith(
			"✅ Te aviso si sale cita el Vie, 2 oct de 17:00 a 19:00.",
		);
		expect(saved.answers).toEqual([undefined]);
		expect(repo.listByChat(CHAT, "2026-09-26")).toEqual([
			{ id: expect.any(Number), chatId: CHAT, day, from: "17:00", to: "19:00" },
		]);
		expect(matching).toEqual([{ chatId: CHAT, hits: ["2026-10-02T17:30"] }]);
	});

	test("asks for the delivery mode only until the chat picks one", async () => {
		const { press } = setup();

		const first = await press({
			kind: "save",
			day: "2026-10-02",
			from: "09:00",
			to: "14:00",
		});
		expect(first.edits[0]?.text).toContain("¿Qué quieres recibir");

		const chosen = await press(
			{ kind: "mode", onlyReminders: true, source: "confirm" },
			first.edits[0]?.text,
		);
		expect(chosen.edits[0]?.text).toBe(
			[
				"✅ Te aviso si sale cita el Vie, 2 oct de 09:00 a 14:00.",
				"Mientras tengas avisos, solo te escribiré cuando salga una cita que encaje. Puedes cambiarlo en /reminders.",
			].join("\n\n"),
		);
		expect(subscribers.getOnlyReminders(CHAT)).toBe(true);

		const second = await press({
			kind: "save",
			day: "2026-10-03",
			from: "09:00",
			to: "14:00",
		});
		expect(second.edits[0]?.text).not.toContain("¿Qué quieres recibir");
	});

	test("a duplicate is not saved twice nor resent", async () => {
		const { press } = setup();
		const save: Callback = {
			kind: "save",
			day: "2026-10-02",
			from: "14:00",
			to: "21:00",
		};

		await press(save);
		const again = await press(save);

		expect(again.edits[0]?.text).toStartWith("Ya tenías ese aviso");
		expect(matching).toHaveLength(1);
	});

	test("refuses more than the limit but ignores past reminders", async () => {
		const { press } = setup();
		repo.insert(CHAT, { day: "2026-09-20", from: "09:00", to: "10:00" });
		for (let hour = 10; hour < 10 + MAX_REMINDERS; hour++)
			repo.insert(CHAT, {
				day: "2026-10-02",
				from: `${hour}:00`,
				to: `${hour}:30`,
			});

		const refused = await press({
			kind: "save",
			day: "2026-10-03",
			from: "09:00",
			to: "14:00",
		});

		expect(refused.edits[0]?.text).toStartWith(
			`Ya tienes ${MAX_REMINDERS} avisos.`,
		);
		expect(repo.countActive(CHAT, "2026-09-26")).toBe(MAX_REMINDERS);
		expect(matching).toEqual([]);
	});

	test("a button for a day that passed goes back to the day picker", async () => {
		const { press } = setup();

		const tapped = await press({
			kind: "save",
			day: "2026-09-25",
			from: "14:00",
			to: "21:00",
		});

		expect(tapped.answers).toEqual(["Ese día ya no está disponible"]);
		expect(tapped.edits[0]?.text).toStartWith("Ese día ya no está disponible.");
		expect(repo.listByChat(CHAT, "2000-01-01")).toEqual([]);
	});

	test("a day beyond what Fresha is checked is refused", async () => {
		const { press } = setup();

		const tapped = await press({ kind: "day", day: "2026-10-27" });

		expect(tapped.answers).toEqual(["Ese día ya no está disponible"]);
	});

	test("a malformed button is answered without editing", async () => {
		const { press } = setup();

		const tapped = await press("r:s:nonsense");

		expect(tapped.edits).toEqual([]);
		expect(tapped.answers).toEqual(["Este botón ya no funciona. Usa /remind."]);
	});

	test("/reminders lists them and a tap removes one", async () => {
		const { command, press } = setup();
		const reminder = repo.insert(CHAT, {
			day: "2026-10-02",
			from: "14:00",
			to: "21:00",
		});
		const { ctx, replies } = fakeCtx();

		await command("reminders", ctx);
		expect(replies[0]?.text).toContain("• Vie, 2 oct de 14:00 a 21:00");

		const removed = await press({ kind: "remove", id: reminder.id });

		expect(removed.answers).toEqual(["Aviso quitado"]);
		expect(removed.edits[0]?.text).toStartWith("No tienes avisos");
		expect(repo.listByChat(CHAT, "2026-09-26")).toEqual([]);
	});

	test("the mode switch in the list flips the mode and redraws it", async () => {
		const { press } = setup();
		repo.insert(CHAT, { day: "2026-10-02", from: "14:00", to: "21:00" });

		const flipped = await press({
			kind: "mode",
			onlyReminders: true,
			source: "list",
		});

		expect(subscribers.getOnlyReminders(CHAT)).toBe(true);
		expect(flipped.edits[0]?.text).toContain("solo te escribiré");
	});

	test("cancel closes the picker", async () => {
		const { press } = setup();

		expect((await press({ kind: "cancel" })).edits[0]?.text).toBe("Cancelado.");
	});
});
