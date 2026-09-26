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
import {
	createSubscribersRepository,
	type SubscribersRepository,
} from "../repository";
import { createTelegramService } from "../service";

type Options = {
	parse_mode?: string;
	link_preview_options?: { is_disabled: boolean };
	reply_markup?: { inline_keyboard: { text: string; url?: string }[][] };
};

const hello: Message = { text: "hello" };

const blocked = new GrammyError(
	"Call to 'sendMessage' failed!",
	{
		ok: false,
		error_code: 403,
		description: "Forbidden: bot was blocked by the user",
	},
	"sendMessage",
	{},
);

const fakeBot = (
	failFor: Set<number> = new Set(),
	editError?: unknown,
	sendError: unknown = new Error("blocked"),
) => {
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
				if (failFor.has(chatId)) return Promise.reject(sendError);
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
	let repo: SubscribersRepository;
	let warn: Mock<typeof log.warn>;

	beforeEach(() => {
		db = openDatabase(":memory:");
		repo = createSubscribersRepository(db);
		warn = spyOn(log, "warn");
	});
	afterEach(() => {
		db.close();
		warn.mockRestore();
	});

	test("notify reaches every subscriber and the admin exactly once", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });
		repo.subscribe(10);
		repo.subscribe(ADMIN);

		await service.notify(hello);

		expect(sent.map((m) => m.chatId).toSorted()).toEqual([ADMIN, 10]);
		expect(sent.every((m) => m.text === "hello")).toBe(true);
	});

	test("notify writes once to a chat that subscribed twice", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });
		repo.subscribe(10);
		repo.subscribe(10);

		await service.notify(hello);

		expect(sent.map((m) => m.chatId).toSorted()).toEqual([ADMIN, 10]);
	});

	test("notify skips a chat that unsubscribed", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });
		repo.subscribe(10);
		repo.subscribe(20);
		repo.unsubscribe(10);

		await service.notify(hello);

		expect(sent.map((m) => m.chatId).toSorted()).toEqual([ADMIN, 20]);
	});

	test("notify only alerts the admin when nobody subscribed", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });

		await service.notify(hello);

		expect(sent.map((m) => [m.chatId, m.text])).toEqual([[ADMIN, "hello"]]);
	});

	test("notify keeps going when one chat rejects the message", async () => {
		const { bot, sent } = fakeBot(new Set([10]));
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });
		repo.subscribe(10);
		repo.subscribe(20);

		await service.notify(hello);

		expect(sent.map((m) => m.chatId).toSorted()).toEqual([ADMIN, 20]);
	});

	test("notify turns the alerts off for a chat that blocked the bot", async () => {
		const { bot } = fakeBot(new Set([10]), undefined, blocked);
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });
		repo.subscribe(10);
		repo.subscribe(20);

		await service.notify(hello);

		expect(repo.listSubscribers()).toEqual([20]);
	});

	test("notify keeps the alerts on when a send fails for another reason", async () => {
		const { bot } = fakeBot(new Set([10]));
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });
		repo.subscribe(10);

		await service.notify(hello);

		expect(repo.listSubscribers()).toEqual([10]);
	});

	test("notify throws when nobody could be reached", () => {
		const { bot } = fakeBot(new Set([ADMIN, 10]));
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });
		repo.subscribe(10);

		expect(service.notify(hello)).rejects.toThrow(/Delivered: 0, Total: 2/);
	});

	test("notify sends HTML with the buttons as an inline URL keyboard", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });

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
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });
		repo.subscribe(10);
		await service.notifyAdmin(hello);

		expect(sent.map((m) => [m.chatId, m.text])).toEqual([[ADMIN, "hello"]]);
	});

	test("notifyAdmin logs and swallows a failed send", async () => {
		const { bot } = fakeBot(new Set([ADMIN]));
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });

		await service.notifyAdmin(hello);

		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("edit rewrites the message text", async () => {
		const { bot, edited } = fakeBot();
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });

		await service.edit(10, 5, { text: "new text" });

		expect(edited.map((m) => [m.chatId, m.messageId, m.text])).toEqual([
			[10, 5, "new text"],
		]);
	});

	test("edit without buttons clears the keyboard", async () => {
		const { bot, edited } = fakeBot();
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });

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
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });

		await service.edit(10, 5, { text: "same text" });

		expect(warn).not.toHaveBeenCalled();
	});

	test("edit logs any other failure and asks to be tried again", async () => {
		const { bot } = fakeBot(new Set(), new Error("network down"));
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });

		const edited = await service.edit(10, 5, { text: "new text" });

		expect(edited).toBe(false);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("edit gives up on a message Telegram will never let it edit", async () => {
		const notFound = new GrammyError(
			"Call to 'editMessageText' failed!",
			{
				ok: false,
				error_code: 400,
				description: "Bad Request: message to edit not found",
			},
			"editMessageText",
			{},
		);
		const { bot } = fakeBot(new Set(), notFound);
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });

		const edited = await service.edit(10, 5, { text: "new text" });

		expect(edited).toBe(true);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("send returns the id of the message it sent", async () => {
		const { bot, sent } = fakeBot();
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });

		const messageId = await service.send(10, hello);

		expect(messageId).toBe(1);
		expect(sent.map((message) => message.chatId)).toEqual([10]);
	});

	test("send logs and swallows a failed send", async () => {
		const { bot } = fakeBot(new Set([10]));
		const service = createTelegramService({ repo, bot, adminChatId: ADMIN });

		const messageId = await service.send(10, hello);

		expect(messageId).toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});
