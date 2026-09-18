import {
	afterEach,
	beforeEach,
	describe,
	expect,
	type Mock,
	spyOn,
	test,
} from "bun:test";
import { type Bot, type Context, GrammyError } from "grammy";
import { type Db, openDatabase } from "@/utils/db";
import { log } from "@/utils/logger";
import { createTelegramService } from "../service";

type Command = (ctx: Context) => unknown;

const fakeBot = (failFor: Set<number> = new Set(), editError?: unknown) => {
	const sent: { chatId: number; text: string }[] = [];
	const edited: { chatId: number; messageId: number; text: string }[] = [];
	const commands = new Map<string, Command>();
	let messageId = 0;
	const bot = {
		api: {
			sendMessage: (chatId: number, text: string) => {
				if (failFor.has(chatId)) return Promise.reject(new Error("blocked"));
				sent.push({ chatId, text });
				messageId += 1;
				return Promise.resolve({ message_id: messageId });
			},
			editMessageText: (chatId: number, messageId: number, text: string) => {
				if (editError) return Promise.reject(editError);
				edited.push({ chatId, messageId, text });
				return Promise.resolve(true);
			},
		},
		command: (name: string, handler: Command) => {
			commands.set(name, handler);
		},
	} as unknown as Bot;
	return { bot, sent, edited, commands };
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
	let warn: Mock<typeof log.warn>;

	beforeEach(() => {
		db = openDatabase(":memory:");
		warn = spyOn(log, "warn");
	});
	afterEach(() => {
		db.close();
		warn.mockRestore();
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

	test("edit rewrites the message text", async () => {
		const { bot, edited } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		await service.edit(10, 5, "new text");

		expect(edited).toEqual([{ chatId: 10, messageId: 5, text: "new text" }]);
	});

	test("edit ignores Telegram's 'message is not modified' error", async () => {
		const notModified = new GrammyError(
			"Call to 'editMessageText' failed!",
			{
				ok: false,
				error_code: 400,
				description:
					"Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
			},
			"editMessageText",
			{},
		);
		const { bot } = fakeBot(new Set(), notModified);
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		await service.edit(10, 5, "same text");

		expect(warn).not.toHaveBeenCalled();
	});

	test("edit logs and swallows any other failure", async () => {
		const { bot } = fakeBot(new Set(), new Error("message can't be edited"));
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		await service.edit(10, 5, "new text");

		expect(warn).toHaveBeenCalledTimes(1);
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
