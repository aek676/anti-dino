import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	createSubscribersRepository,
	type SubscribersRepository,
} from "@/modules/telegram";
import { createTransaction, type Db, openDatabase } from "@/utils/db";
import { registerReminders } from "../handlers";
import { MAX_REMINDERS } from "../model";
import {
	createRemindersRepository,
	type RemindersRepository,
} from "../repository";
import { createRemindersService } from "../service";
import { buttons, CHAT, createTestBot } from "./harness";

const BROKEN = "Este botón ya no funciona. Usa /remind.";
const DAY_GONE = "Ese día ya no está disponible.";

describe("reminder handlers", () => {
	let db: Db;
	let repo: RemindersRepository;
	let subscribers: SubscribersRepository;
	let matching: { chatId: number; hits: string[] }[];
	let now: string;
	let sendMatchingFails: boolean;
	const openSlots = [
		"2026-10-02T12:00",
		"2026-10-02T17:30",
		"2026-10-03T17:30",
	];

	const setup = () =>
		createTestBot(db, (bot) =>
			registerReminders(
				bot,
				createRemindersService({
					repo,
					subscribers,
					sendMatching: (chatId, isMatch) => {
						if (sendMatchingFails) return Promise.reject(new Error("boom"));
						matching.push({ chatId, hits: openSlots.filter(isMatch) });
						return Promise.resolve();
					},
					transaction: createTransaction(db),
					config: { timeZone: "Europe/Madrid", daysAhead: 31 },
					now: () => Temporal.Instant.from(now),
				}),
			),
		);

	const conversationRows = () =>
		db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM conversations").get()
			?.n;

	beforeEach(() => {
		db = openDatabase(":memory:");
		repo = createRemindersRepository(db);
		subscribers = createSubscribersRepository(db);
		matching = [];
		now = "2026-09-26T10:00:00Z";
		sendMatchingFails = false;
	});
	afterEach(() => {
		db.close();
	});

	test("/remind starts with the day picker", async () => {
		const { command } = setup();

		const { sent } = await command("/remind");

		expect(sent[0]?.text).toBe("¿Qué día quieres la cita?");
		expect(buttons(sent[0]?.keyboard)[0]?.[0]).toEqual({
			text: "Hoy",
			data: "day:2026-09-26",
		});
		expect(conversationRows()).toBe(1);
	});

	test("another hour walks through start and end and saves the reminder", async () => {
		const { command, tap } = setup();
		await command("/remind");

		expect((await tap("day:2026-10-02")).edits[0]?.text).toBe(
			"Vie, 2 oct: ¿a qué hora?",
		);
		expect((await tap("other")).edits[0]?.text).toBe(
			"Vie, 2 oct: ¿desde qué hora?",
		);
		expect((await tap("from:17:00")).edits[0]?.text).toBe(
			"Vie, 2 oct desde las 17:00: ¿hasta qué hora?",
		);

		const saved = await tap("to:19:00");

		expect(saved.edits[0]?.text).toStartWith(
			"✅ Te aviso si sale cita el Vie, 2 oct de 17:00 a 19:00.",
		);
		expect(saved.answers).toEqual([undefined]);
		expect(repo.listByChat(CHAT, "2026-09-26")).toEqual([
			{
				id: expect.any(Number),
				chatId: CHAT,
				day: "2026-10-02",
				from: "17:00",
				to: "19:00",
			},
		]);
		expect(matching).toEqual([{ chatId: CHAT, hits: ["2026-10-02T17:30"] }]);
		expect(conversationRows()).toBe(0);
	});

	test("a named range saves right away", async () => {
		const { command, tap } = setup();
		await command("/remind");
		await tap("day:2026-10-02");

		const saved = await tap("range:14:00-21:00");

		expect(saved.edits[0]?.text).toStartWith(
			"✅ Te aviso si sale cita el Vie, 2 oct de 14:00 a 21:00.",
		);
		expect(matching).toEqual([{ chatId: CHAT, hits: ["2026-10-02T17:30"] }]);
	});

	test("the pages move forward and back; a page that was not offered is refused", async () => {
		const { command, tap } = setup();
		await command("/remind");

		const next = await tap("page:1");
		expect(buttons(next.edits[0]?.keyboard)[0]?.[0]?.text).toBe("Sáb 3");

		expect((await tap("page:99")).answers).toEqual([BROKEN]);

		const back = await tap("page:0");
		expect(buttons(back.edits[0]?.keyboard)[0]?.[0]?.text).toBe("Hoy");
	});

	test("back goes to the previous step, with the day picker on the day's page", async () => {
		const { command, tap } = setup();
		await command("/remind");
		await tap("page:1");
		await tap("day:2026-10-05");
		await tap("other");
		await tap("from:16:00");

		expect((await tap("back")).edits[0]?.text).toBe(
			"Lun, 5 oct: ¿desde qué hora?",
		);
		expect((await tap("back")).edits[0]?.text).toBe("Lun, 5 oct: ¿a qué hora?");

		const days = await tap("back");
		expect(days.edits[0]?.text).toBe("¿Qué día quieres la cita?");
		expect(buttons(days.edits[0]?.keyboard)[0]?.[0]?.text).toBe("Sáb 3");
	});

	test("cancel closes the picker and ends the flow", async () => {
		const { command, tap } = setup();
		await command("/remind");

		expect((await tap("cancel")).edits[0]?.text).toBe("Cancelado.");
		expect(conversationRows()).toBe(0);
		expect((await tap("day:2026-10-02")).answers).toEqual([BROKEN]);
	});

	test("asks for the delivery mode only until the chat picks one", async () => {
		const { command, tap, lastMessageId } = setup();
		await command("/remind");
		await tap("day:2026-10-02");

		const first = await tap("range:09:00-14:00");
		const text = first.edits[0]?.text ?? "";
		expect(text).toContain("¿Qué quieres recibir");

		const chosen = await tap("rem:mode:only:confirm", lastMessageId(), text);
		expect(chosen.edits[0]?.text).toBe(
			[
				"✅ Te aviso si sale cita el Vie, 2 oct de 09:00 a 14:00.",
				"Mientras tengas avisos, solo te escribiré cuando salga una cita que encaje. Puedes cambiarlo en /reminders.",
			].join("\n\n"),
		);
		expect(subscribers.getOnlyReminders(CHAT)).toBe(true);

		await command("/remind");
		await tap("day:2026-10-01");
		const second = await tap("range:09:00-14:00");
		expect(second.edits[0]?.text).not.toContain("¿Qué quieres recibir");
	});

	test("a duplicate is not saved twice nor resent", async () => {
		const { command, tap } = setup();
		await command("/remind");
		await tap("day:2026-10-02");
		await tap("range:14:00-21:00");

		await command("/remind");
		await tap("day:2026-10-02");
		const again = await tap("range:14:00-21:00");

		expect(again.edits[0]?.text).toStartWith("Ya tenías ese aviso");
		expect(matching).toHaveLength(1);
	});

	test("refuses more than the limit but ignores past reminders", async () => {
		const { command, tap } = setup();
		repo.insert(CHAT, { day: "2026-09-20", from: "09:00", to: "10:00" });
		for (let hour = 10; hour < 10 + MAX_REMINDERS; hour++)
			repo.insert(CHAT, {
				day: "2026-10-02",
				from: `${hour}:00`,
				to: `${hour}:30`,
			});
		await command("/remind");
		await tap("day:2026-10-01");

		const refused = await tap("range:09:00-14:00");

		expect(refused.edits[0]?.text).toStartWith(
			`Ya tienes ${MAX_REMINDERS} avisos.`,
		);
		expect(repo.countActive(CHAT, "2026-09-26")).toBe(MAX_REMINDERS);
		expect(matching).toEqual([]);
	});

	test("a day that passes while the picker is open goes back to the day picker", async () => {
		const { command, tap } = setup();
		await command("/remind");
		await tap("day:2026-09-27");
		now = "2026-09-28T10:00:00Z";

		const tapped = await tap("range:14:00-21:00");

		expect(tapped.answers).toEqual([DAY_GONE]);
		expect(tapped.edits[0]?.text).toStartWith(DAY_GONE);
		expect(repo.listByChat(CHAT, "2000-01-01")).toEqual([]);

		expect((await tap("day:2026-09-28")).edits[0]?.text).toBe(
			"Lun, 28 sept: ¿a qué hora?",
		);
	});

	test("a day that passed since the picker was drawn is refused", async () => {
		const { command, tap } = setup();
		await command("/remind");
		now = "2026-09-27T10:00:00Z";

		const tapped = await tap("day:2026-09-26");

		expect(tapped.answers).toEqual([DAY_GONE]);
		expect(tapped.edits[0]?.text).toStartWith(DAY_GONE);
	});

	test("buttons from another step or from before are answered without editing", async () => {
		const { command, tap } = setup();
		await command("/remind");

		expect(await tap("range:09:00-14:00")).toEqual({
			sent: [],
			edits: [],
			answers: [BROKEN],
		});
		expect((await tap("r:s:2026-10-02:1400:2100")).answers).toEqual([BROKEN]);
		expect((await tap("day:2026-10-02")).edits[0]?.text).toBe(
			"Vie, 2 oct: ¿a qué hora?",
		);
	});

	test("a second /remind replaces the open picker", async () => {
		const { command, tap, lastMessageId } = setup();
		await command("/remind");
		const old = lastMessageId();
		await tap("day:2026-10-02");

		await command("/remind");
		expect(conversationRows()).toBe(1);

		expect((await tap("range:09:00-14:00", old)).answers).toEqual([BROKEN]);
		expect((await tap("day:2026-10-01")).edits[0]?.text).toBe(
			"Jue, 1 oct: ¿a qué hora?",
		);
	});

	test("/reminders and its buttons keep working while a picker is open", async () => {
		const { command, tap, lastMessageId } = setup();
		const reminder = repo.insert(CHAT, {
			day: "2026-10-02",
			from: "14:00",
			to: "21:00",
		});
		await command("/remind");
		const picker = lastMessageId();

		const listed = await command("/reminders");
		expect(listed.sent[0]?.text).toContain("• Vie, 2 oct de 14:00 a 21:00");

		const removed = await tap(`rem:remove:${reminder.id}`);
		expect(removed.answers).toEqual(["Aviso quitado"]);
		expect(removed.edits[0]?.text).toStartWith("No tienes avisos");
		expect(repo.listByChat(CHAT, "2026-09-26")).toEqual([]);

		expect((await tap("day:2026-10-02", picker)).edits[0]?.text).toBe(
			"Vie, 2 oct: ¿a qué hora?",
		);
	});

	test("the mode switch in the list flips the mode and redraws it", async () => {
		const { command, tap } = setup();
		repo.insert(CHAT, { day: "2026-10-02", from: "14:00", to: "21:00" });
		await command("/reminders");

		const flipped = await tap("rem:mode:only:list");

		expect(subscribers.getOnlyReminders(CHAT)).toBe(true);
		expect(flipped.edits[0]?.text).toContain("solo te escribiré");
	});

	test("a half-finished picker survives a restart", async () => {
		const first = setup();
		await first.command("/remind");
		await first.tap("day:2026-10-02");
		await first.tap("other");

		const second = setup();
		const resumed = await second.tap("from:17:00", first.lastMessageId());
		expect(resumed.edits[0]?.text).toBe(
			"Vie, 2 oct desde las 17:00: ¿hasta qué hora?",
		);

		const saved = await second.tap("to:19:00", first.lastMessageId());
		expect(saved.edits[0]?.text).toStartWith("✅ Te aviso");
		expect(matching).toHaveLength(1);
	});

	test("a failure while saving is reported and ends the flow", async () => {
		const { command, tap } = setup();
		await command("/remind");
		await tap("day:2026-10-02");
		sendMatchingFails = true;

		const failed = await tap("range:09:00-14:00");

		expect(failed.edits[0]?.text).toBe("Algo ha fallado, inténtalo de nuevo.");
		expect(conversationRows()).toBe(0);
	});
});
