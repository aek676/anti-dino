import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import type { BotContext } from "@/modules/telegram";
import { log } from "@/utils/logger";
import type { ReminderModel } from "./model";
import { show } from "./render";
import type { RemindersService, SaveResult } from "./service";
import * as views from "./views";

export const REMIND = "remind";

/** A picker left open longer than this stops working; the next tap gets the fallback. */
export const REMIND_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export const BROKEN_BUTTON = "Este botón ya no funciona. Usa /remind.";
export const FAILED = "Algo ha fallado, inténtalo de nuevo.";
const DAY_GONE = "Ese día ya no está disponible.";

type Step =
	| { step: "day"; page: number; notice?: string }
	| { step: "range"; day: string }
	| { step: "from"; day: string }
	| { step: "to"; day: string; from: string };

/** The last thing the flow shows. */
type End = { end: views.View };

const buttonsOf = (view: views.View) =>
	(view.keyboard?.inline_keyboard ?? [])
		.flat()
		.flatMap((button) =>
			"callback_data" in button ? [button.callback_data] : [],
		);

const choiceOf = (data: string) => data.slice(data.indexOf(":") + 1);

const outcome = (
	result: SaveResult | { status: "failed" },
): views.View | undefined => {
	switch (result.status) {
		case "added":
			return views.saved(result.reminder, result.askMode);
		case "duplicate":
			return views.duplicate(result.reminder);
		case "limit":
			return views.limitReached;
		case "failed":
			return { text: FAILED };
		case "expired":
			return undefined;
	}
};

export const createRemindConversation =
	(service: RemindersService) =>
	async (
		conversation: Conversation<BotContext, Context>,
		ctx: Context,
		chatId: number,
	) => {
		const { daysAhead } = service;
		const today = () => conversation.external(() => service.today());
		const dayGone: Step = { step: "day", page: 0, notice: DAY_GONE };

		const viewOf = async (step: Step): Promise<views.View> => {
			switch (step.step) {
				case "day":
					return views.dayPicker(
						await today(),
						daysAhead,
						step.page,
						step.notice,
					);
				case "range":
					return views.rangePicker(step.day);
				case "from":
					return views.fromPicker(step.day);
				case "to":
					return views.toPicker(step.day, step.from);
			}
		};

		const back = async (step: Step): Promise<Step> => {
			switch (step.step) {
				case "range":
					return { step: "day", page: views.pageOf(await today(), step.day) };
				case "from":
					return { step: "range", day: step.day };
				case "to":
					return { step: "from", day: step.day };
				case "day":
					return step;
			}
		};

		const save = async (
			range: ReminderModel["reminderRange"],
		): Promise<Step | End> => {
			const result = await conversation.external(() =>
				service.save(chatId, range).catch((error: unknown) => {
					log.warn({ chatId, range, err: error }, "saving reminder failed");
					return { status: "failed" as const };
				}),
			);
			const view = outcome(result);
			return view ? { end: view } : dayGone;
		};

		const advance = async (step: Step, data: string): Promise<Step | End> => {
			const value = choiceOf(data);
			if (data === "cancel") return { end: views.cancelled };
			if (data === "back") return back(step);
			switch (step.step) {
				case "day": {
					if (data.startsWith("page:"))
						return { step: "day", page: Number(value) };
					const bookable = await conversation.external(() =>
						service.isBookable(value),
					);
					return bookable ? { step: "range", day: value } : dayGone;
				}
				case "range": {
					if (data === "other") return { step: "from", day: step.day };
					const [from = "", to = ""] = value.split("-");
					return save({ day: step.day, from, to });
				}
				case "from":
					return { step: "to", day: step.day, from: value };
				case "to":
					return save({ day: step.day, from: step.from, to: value });
			}
		};

		let step: Step = { step: "day", page: 0 };
		let view = await viewOf(step);
		const { message_id: messageId } = await ctx.reply(view.text, {
			reply_markup: view.keyboard,
		});

		for (;;) {
			// Only a button of the view on screen, on this message, belongs here; the rest goes
			// on to the other handlers (commands, the list's buttons, older /remind messages).
			const c = await conversation
				.waitForCallbackQuery(buttonsOf(view), { next: true })
				.and((c) => c.callbackQuery.message?.message_id === messageId, {
					next: true,
				});

			const next = await advance(step, c.callbackQuery.data);
			view = "end" in next ? next.end : await viewOf(next);
			await show(c, view);
			await c.answerCallbackQuery(
				"notice" in next && next.notice ? { text: next.notice } : undefined,
			);
			if ("end" in next) return;
			step = next;
		}
	};
