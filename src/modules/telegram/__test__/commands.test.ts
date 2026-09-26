import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Bot, Context } from "grammy";
import { type Db, openDatabase } from "@/utils/db";
import { COMMANDS, registerCommands } from "../commands";
import {
	createSubscribersRepository,
	type SubscribersRepository,
} from "../repository";

type Handler = (ctx: Context) => unknown;

const fakeBot = () => {
	const commands = new Map<string, Handler>();
	const updates = new Map<string, Handler>();
	const bot = {
		command: (name: string, handler: Handler) => {
			commands.set(name, handler);
		},
		on: (filter: string, handler: Handler) => {
			updates.set(filter, handler);
		},
	} as unknown as Bot;
	return { bot, commands, updates };
};

const fakeCtx = (chatId: number, memberStatus?: string) => {
	const replies: string[] = [];
	const options: unknown[] = [];
	const ctx = {
		chatId,
		myChatMember: { new_chat_member: { status: memberStatus } },
		reply: (text: string, replyOptions?: unknown) => {
			replies.push(text);
			options.push(replyOptions);
			return Promise.resolve();
		},
	} as unknown as Context;
	return { ctx, replies, options };
};

describe("telegram commands", () => {
	let db: Db;
	let repo: SubscribersRepository;
	let slotsSentTo: number[];

	const setup = () => {
		const { bot, commands, updates } = fakeBot();
		registerCommands(bot, {
			...repo,
			sendSlots: (chatId) => {
				slotsSentTo.push(chatId);
				return Promise.resolve();
			},
		});
		return { commands, updates };
	};

	beforeEach(() => {
		db = openDatabase(":memory:");
		repo = createSubscribersRepository(db);
		slotsSentTo = [];
	});
	afterEach(() => {
		db.close();
	});

	test("/start subscribes a new chat, welcomes it and sends the current slots", async () => {
		const { commands } = setup();
		const { ctx, replies, options } = fakeCtx(10);

		await commands.get("start")?.(ctx);

		expect(repo.listSubscribers()).toEqual([10]);
		expect(replies).toHaveLength(1);
		for (const { command } of COMMANDS)
			expect(replies[0]).toContain(`/${command}`);
		expect(replies[0]).not.toContain("/start");
		expect(options[0]).toEqual({ parse_mode: "HTML" });
		expect(slotsSentTo).toEqual([10]);
	});

	test("/start keeps the alerts off for a chat that turned them off", async () => {
		const { commands } = setup();
		repo.subscribe(10);
		repo.unsubscribe(10);
		const { ctx } = fakeCtx(10);

		await commands.get("start")?.(ctx);

		expect(repo.listSubscribers()).toEqual([]);
		expect(slotsSentTo).toEqual([10]);
	});

	test("/slots sends the current slots", async () => {
		const { commands } = setup();
		const { ctx } = fakeCtx(10);

		await commands.get("slots")?.(ctx);

		expect(slotsSentTo).toEqual([10]);
	});

	test("/subscribe turns the alerts on and sends the current slots", async () => {
		const { commands } = setup();
		repo.subscribe(10);
		repo.unsubscribe(10);
		const { ctx, replies } = fakeCtx(10);

		await commands.get("subscribe")?.(ctx);

		expect(repo.listSubscribers()).toEqual([10]);
		expect(replies).toEqual(["Alerts on."]);
		expect(slotsSentTo).toEqual([10]);
	});

	test("/unsubscribe turns the alerts off and confirms", async () => {
		const { commands } = setup();
		repo.subscribe(10);
		const { ctx, replies } = fakeCtx(10);

		await commands.get("unsubscribe")?.(ctx);

		expect(repo.listSubscribers()).toEqual([]);
		expect(replies).toEqual([
			"Alerts off. Send /subscribe to turn them back on.",
		]);
	});
});
