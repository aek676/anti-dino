import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Bot, Context } from "grammy";
import { createTelegramService } from "@/modules/telegram/service";
import { type Db, openDatabase } from "@/utils/db";

type Command = (ctx: Context) => unknown;

const fakeBot = (failFor: Set<number> = new Set()) => {
	const sent: { chatId: number; text: string }[] = [];
	const commands = new Map<string, Command>();
	const bot = {
		api: {
			sendMessage: (chatId: number, text: string) => {
				if (failFor.has(chatId)) return Promise.reject(new Error("blocked"));
				sent.push({ chatId, text });
				return Promise.resolve();
			},
		},
		command: (name: string, handler: Command) => {
			commands.set(name, handler);
		},
	} as unknown as Bot;
	return { bot, sent, commands };
};

const fakeCtx = (chatId: number) => {
	const replies: string[] = [];
	const ctx = {
		chatId,
		reply: (text: string) => {
			replies.push(text);
			return Promise.resolve();
		},
	} as unknown as Context;
	return { ctx, replies };
};

const ADMIN = 1;

describe("telegram service", () => {
	let db: Db;

	beforeEach(() => {
		db = openDatabase(":memory:");
	});
	afterEach(() => {
		db.close();
	});

	test("subscribe stores the chat once", () => {
		const { bot } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		service.subscribe(10);
		service.subscribe(10);
		service.subscribe(20);

		expect(service.listSubscribers().toSorted()).toEqual([10, 20]);
	});

	test("unsubscribe removes the chat", () => {
		const { bot } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		service.subscribe(10);
		service.unsubscribe(10);

		expect(service.listSubscribers()).toEqual([]);
	});

	test("notify reaches every subscriber and the admin exactly once", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });
		service.subscribe(10);
		service.subscribe(ADMIN);

		await service.notify("hello");

		expect(sent.map((m) => m.chatId).toSorted()).toEqual([ADMIN, 10]);
		expect(sent.every((m) => m.text === "hello")).toBe(true);
	});

	test("notify only alerts the admin when nobody subscribed", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		await service.notify("hello");

		expect(sent).toEqual([{ chatId: ADMIN, text: "hello" }]);
	});

	test("notify keeps going when one chat rejects the message", async () => {
		const { bot, sent } = fakeBot(new Set([10]));
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });
		service.subscribe(10);
		service.subscribe(20);

		await service.notify("hello");

		expect(sent.map((m) => m.chatId).toSorted()).toEqual([ADMIN, 20]);
	});

	test("notify throws when nobody could be reached", () => {
		const { bot } = fakeBot(new Set([ADMIN, 10]));
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });
		service.subscribe(10);

		expect(service.notify("hello")).rejects.toThrow(/Delivered: 0, Total: 2/);
	});

	test("/start subscribes the chat and confirms", async () => {
		const { bot, commands } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });
		const { ctx, replies } = fakeCtx(10);

		await commands.get("start")?.(ctx);

		expect(service.listSubscribers()).toEqual([10]);
		expect(replies).toEqual(["You have subscribed to notifications."]);
	});

	test("/stop unsubscribes the chat and confirms", async () => {
		const { bot, commands } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });
		service.subscribe(10);
		const { ctx, replies } = fakeCtx(10);

		await commands.get("stop")?.(ctx);

		expect(service.listSubscribers()).toEqual([]);
		expect(replies).toEqual(["You have unsubscribed from notifications."]);
	});
});
