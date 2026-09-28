/**
 * A real grammY bot fed with hand-made updates. Telegram is replaced by a fake `fetch` that
 * records every call and answers with the minimum the plugin and handlers need. It has to be
 * `fetch` and not an API transformer because the conversations plugin builds its own `Api`.
 */

import { conversations } from "@grammyjs/conversations";
import { Bot, type InlineKeyboard } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import {
	type BotContext,
	createConversationsRepository,
} from "@/modules/telegram";
import type { Db } from "@/utils/db";

export const CHAT = 10;

const BOT_INFO: UserFromGetMe = {
	id: 42,
	is_bot: true,
	first_name: "anti-dino",
	username: "anti_dino_bot",
	can_join_groups: true,
	can_read_all_group_messages: false,
	supports_inline_queries: false,
	can_connect_to_business: false,
	has_main_web_app: false,
	allows_users_to_create_topics: false,
	has_topics_enabled: false,
	can_manage_bots: false,
	supports_join_request_queries: false,
};

const chat = { id: CHAT, type: "private" as const, first_name: "u" };
const from = { id: CHAT, is_bot: false, first_name: "u" };

export type Call = {
	method: string;
	payload: Record<string, unknown> & { text?: string; message_id?: number };
};

export type Sent = {
	messageId: number;
	text: string;
	keyboard?: InlineKeyboard;
};

const shown = (call: Call): Sent => ({
	messageId: Number(call.payload.message_id),
	text: String(call.payload.text),
	keyboard: call.payload.reply_markup as InlineKeyboard | undefined,
});

export const buttons = (keyboard?: InlineKeyboard) =>
	(keyboard?.inline_keyboard ?? []).map((row) =>
		row.map((button) => ({
			text: button.text,
			data: "callback_data" in button ? button.callback_data : undefined,
		})),
	);

export const createTestBot = (
	db: Db,
	register: (bot: Bot<BotContext>) => void,
) => {
	const calls: Call[] = [];
	let messageId = 100;
	let updateId = 0;
	const lastEdit = new Map<number, string>();

	const telegram = (input: string | URL | Request, init?: RequestInit) => {
		const method = String(input).split("/").at(-1) ?? "";
		const payload = JSON.parse(String(init?.body ?? "{}")) as Call["payload"];
		calls.push({ method, payload });
		const respond = (body: unknown) => Promise.resolve(Response.json(body));
		const ok = (result: unknown) => respond({ ok: true, result });

		if (method === "sendMessage") {
			messageId++;
			return ok({ message_id: messageId, date: 0, chat, text: payload.text });
		}
		if (method === "editMessageText") {
			const id = Number(payload.message_id);
			const body = JSON.stringify([payload.text, payload.reply_markup]);
			if (lastEdit.get(id) === body)
				return respond({
					ok: false,
					error_code: 400,
					description: "Bad Request: message is not modified",
				});
			lastEdit.set(id, body);
			return ok({ message_id: id, date: 0, chat, text: payload.text });
		}
		return ok(true);
	};

	const bot = new Bot<BotContext>("42:test", {
		botInfo: BOT_INFO,
		client: { fetch: telegram as typeof fetch },
	});

	bot.use(
		conversations({
			storage: {
				type: "key",
				version: 1,
				adapter: createConversationsRepository(db),
			},
		}),
	);
	register(bot);

	const since = (start: number) => calls.slice(start);

	return {
		bot,
		calls,
		/** The id Telegram would have given the latest message the bot sent. */
		lastMessageId: () => messageId,
		command: async (text: string) => {
			const start = calls.length;
			await bot.handleUpdate({
				update_id: ++updateId,
				message: {
					message_id: ++updateId,
					date: 0,
					chat,
					from,
					text,
					entities: [{ type: "bot_command", offset: 0, length: text.length }],
				},
			});
			return outcome(since(start));
		},
		/** Taps a button with `data` on the message `onMessage` (the latest one sent by default). */
		tap: async (data: string, onMessage?: number, text = "") => {
			const start = calls.length;
			await bot.handleUpdate({
				update_id: ++updateId,
				callback_query: {
					id: String(updateId),
					from,
					chat_instance: "1",
					data,
					message: { message_id: onMessage ?? messageId, date: 0, chat, text },
				},
			});
			return outcome(since(start));
		},
	};
};

/** What one update made the bot do. */
const outcome = (calls: Call[]) => ({
	sent: calls.filter((c) => c.method === "sendMessage").map(shown),
	edits: calls.filter((c) => c.method === "editMessageText").map(shown),
	answers: calls
		.filter((c) => c.method === "answerCallbackQuery")
		.map((c) => c.payload.text),
});
