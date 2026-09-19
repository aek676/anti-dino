import { beforeEach, describe, expect, test } from "bun:test";
import type { Bot, Context } from "grammy";
import { COMMANDS, registerCommands } from "../commands";

type Handler = (ctx: Context) => unknown;
type Keyboard = {
	inline_keyboard: { text: string; callback_data?: string }[][];
};

const fakeBot = () => {
	const commands = new Map<string, Handler>();
	const callbacks = new Map<string, Handler>();
	const bot = {
		command: (name: string, handler: Handler) => {
			commands.set(name, handler);
		},
		callbackQuery: (data: string, handler: Handler) => {
			callbacks.set(data, handler);
		},
	} as unknown as Bot;
	return { bot, commands, callbacks };
};

const fakeCtx = (chatId: number) => {
	const replies: string[] = [];
	const keyboards: (Keyboard | undefined)[] = [];
	const events: string[] = [];
	const ctx = {
		chatId,
		reply: (text: string, options?: { reply_markup?: Keyboard }) => {
			replies.push(text);
			keyboards.push(options?.reply_markup);
			return Promise.resolve();
		},
		answerCallbackQuery: () => {
			events.push("answered");
			return Promise.resolve(true);
		},
		editMessageReplyMarkup: () => {
			events.push("button removed");
			return Promise.resolve(true);
		},
	} as unknown as Context;
	return { ctx, replies, keyboards, events };
};

describe("telegram commands", () => {
	let subscribers: Set<number>;
	let slotsSentTo: number[];

	const setup = () => {
		const { bot, commands, callbacks } = fakeBot();
		registerCommands(bot, {
			subscribe: (chatId) => {
				subscribers.add(chatId);
			},
			unsubscribe: (chatId) => {
				subscribers.delete(chatId);
			},
			isSubscribed: (chatId) => subscribers.has(chatId),
			sendSlots: (chatId) => {
				slotsSentTo.push(chatId);
				return Promise.resolve();
			},
		});
		return { commands, callbacks };
	};

	beforeEach(() => {
		subscribers = new Set();
		slotsSentTo = [];
	});

	test("/start welcomes a new chat with the commands and a start button", async () => {
		const { commands } = setup();
		const { ctx, replies, keyboards } = fakeCtx(10);

		await commands.get("start")?.(ctx);

		expect([...subscribers]).toEqual([]);
		expect(slotsSentTo).toEqual([]);
		expect(replies).toHaveLength(1);
		for (const { command } of COMMANDS)
			expect(replies[0]).toContain(`/${command}`);
		expect(keyboards[0]?.inline_keyboard).toEqual([
			[{ text: "🚀 Start", callback_data: "subscribe" }],
		]);
	});

	test("the start button subscribes the chat and sends the current slots", async () => {
		const { callbacks } = setup();
		const { ctx, replies, events } = fakeCtx(10);

		await callbacks.get("subscribe")?.(ctx);

		expect([...subscribers]).toEqual([10]);
		expect(events).toEqual(["answered", "button removed"]);
		expect(replies).toEqual(["You have subscribed to notifications."]);
		expect(slotsSentTo).toEqual([10]);
	});

	test("/start sends the current slots to a chat that already subscribed", async () => {
		const { commands } = setup();
		subscribers.add(10);
		const { ctx, replies } = fakeCtx(10);

		await commands.get("start")?.(ctx);

		expect(replies).toEqual([]);
		expect(slotsSentTo).toEqual([10]);
	});

	test("/slots sends the current slots", async () => {
		const { commands } = setup();
		const { ctx } = fakeCtx(10);

		await commands.get("slots")?.(ctx);

		expect(slotsSentTo).toEqual([10]);
	});

	test("/stop unsubscribes the chat and confirms", async () => {
		const { commands } = setup();
		subscribers.add(10);
		const { ctx, replies } = fakeCtx(10);

		await commands.get("stop")?.(ctx);

		expect([...subscribers]).toEqual([]);
		expect(replies).toEqual(["You have unsubscribed from notifications."]);
	});
});
