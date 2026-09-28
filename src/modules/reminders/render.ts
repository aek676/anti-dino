import { type Context, GrammyError } from "grammy";
import type { View } from "./views";

export const reply = (ctx: Context, view: View) =>
	ctx.reply(view.text, { reply_markup: view.keyboard });

/** Replaces the message the button sits on; a repeated tap that changes nothing is fine. */
export const show = async (ctx: Context, view: View) => {
	try {
		await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
	} catch (error) {
		if (
			error instanceof GrammyError &&
			error.description.includes("message is not modified")
		)
			return;
		throw error;
	}
};
