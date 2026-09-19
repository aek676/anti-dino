import {
	afterEach,
	beforeEach,
	describe,
	expect,
	type Mock,
	spyOn,
	test,
} from "bun:test";
import { type Bot, GrammyError } from "grammy";
import { type Db, openDatabase } from "@/utils/db";
import { log } from "@/utils/logger";
import type { Message } from "../model";
import { createTelegramService } from "../service";

type Options = {
	parse_mode?: string;
	link_preview_options?: { is_disabled: boolean };
	reply_markup?: { inline_keyboard: { text: string; url?: string }[][] };
};

const hello: Message = { text: "hello" };

const fakeBot = (failFor: Set<number> = new Set(), editError?: unknown) => {
	const sent: { chatId: number; text: string; options?: Options }[] = [];
	const edited: {
		chatId: number;
		messageId: number;
		text: string;
		options?: Options;
	}[] = [];
	let messageId = 0;
	const bot = {
		api: {
			sendMessage: (chatId: number, text: string, options?: Options) => {
				if (failFor.has(chatId)) return Promise.reject(new Error("blocked"));
				sent.push({ chatId, text, options });
				messageId += 1;
				return Promise.resolve({ message_id: messageId });
			},
			editMessageText: (
				chatId: number,
				messageId: number,
				text: string,
				options?: Options,
			) => {
				if (editError) return Promise.reject(editError);
				edited.push({ chatId, messageId, text, options });
				return Promise.resolve(true);
			},
		},
	} as unknown as Bot;
	return { bot, sent, edited };
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

		await service.notify(hello);

		expect(sent.map((m) => m.chatId).toSorted()).toEqual([ADMIN, 10]);
		expect(sent.every((m) => m.text === "hello")).toBe(true);
	});

	test("notify only alerts the admin when nobody subscribed", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		await service.notify(hello);

		expect(sent.map((m) => [m.chatId, m.text])).toEqual([[ADMIN, "hello"]]);
	});

	test("notify keeps going when one chat rejects the message", async () => {
		const { bot, sent } = fakeBot(new Set([10]));
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });
		service.subscribe(10);
		service.subscribe(20);

		await service.notify(hello);

		expect(sent.map((m) => m.chatId).toSorted()).toEqual([ADMIN, 20]);
	});

	test("notify throws when nobody could be reached", () => {
		const { bot } = fakeBot(new Set([ADMIN, 10]));
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });
		service.subscribe(10);

		expect(service.notify(hello)).rejects.toThrow(/Delivered: 0, Total: 2/);
	});

	test("notify sends HTML with the buttons as an inline URL keyboard", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		await service.notify({
			text: "<b>hello</b>",
			buttons: [[{ label: "Book", url: "https://example.com/book" }]],
		});

		expect(sent[0]?.options?.parse_mode).toBe("HTML");
		expect(sent[0]?.options?.link_preview_options).toEqual({
			is_disabled: true,
		});
		expect(sent[0]?.options?.reply_markup?.inline_keyboard).toEqual([
			[{ text: "Book", url: "https://example.com/book" }],
		]);
	});
	test("notifyAdmin writes to the admin only", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });
		service.subscribe(10);
		await service.notifyAdmin(hello);

		expect(sent.map((m) => [m.chatId, m.text])).toEqual([[ADMIN, "hello"]]);
	});

	test("notifyAdmin logs and swallows a failed send", async () => {
		const { bot } = fakeBot(new Set([ADMIN]));
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		await service.notifyAdmin(hello);

		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("edit rewrites the message text", async () => {
		const { bot, edited } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		await service.edit(10, 5, { text: "new text" });

		expect(edited.map((m) => [m.chatId, m.messageId, m.text])).toEqual([
			[10, 5, "new text"],
		]);
	});

	test("edit without buttons clears the keyboard", async () => {
		const { bot, edited } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		await service.edit(10, 5, { text: "new text" });

		expect(edited[0]?.options?.reply_markup?.inline_keyboard).toEqual([]);
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

		await service.edit(10, 5, { text: "same text" });

		expect(warn).not.toHaveBeenCalled();
	});

	test("edit logs and swallows any other failure", async () => {
		const { bot } = fakeBot(new Set(), new Error("message can't be edited"));
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		await service.edit(10, 5, { text: "new text" });

		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("send returns the id of the message it sent", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		const messageId = await service.send(10, hello);

		expect(messageId).toBe(1);
		expect(sent.map((message) => message.chatId)).toEqual([10]);
	});

	test("send logs and swallows a failed send", async () => {
		const { bot } = fakeBot(new Set([10]));
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });

		const messageId = await service.send(10, hello);

		expect(messageId).toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("isSubscribed tells a subscribed chat from a new one", () => {
		const { bot } = fakeBot();
		const service = createTelegramService({ db, bot, adminChatId: ADMIN });
		service.subscribe(10);

		expect(service.isSubscribed(10)).toBe(true);
		expect(service.isSubscribed(20)).toBe(false);
	});
});
