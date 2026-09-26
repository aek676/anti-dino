import { html } from "@elysiajs/html";
import { Elysia, t } from "elysia";
import { type BookDeps, createBookService } from "./service";
import { openInFreshaPage } from "./view";

export { type BookOutcome, parseSlot } from "./model";
export {
	type BookConfig,
	type BookDeps,
	type BookResult,
	createBookService,
} from "./service";

export const BOOK_PATH = "/book";

export const slotUrl = (publicUrl: string, startsAt: string): string =>
	`${publicUrl}${BOOK_PATH}/${startsAt}`;

const IOS = /iPhone|iPad|iPod/;

export const book = (deps: BookDeps) => {
	const bookService = createBookService(deps);

	return new Elysia({ name: "book" }).use(html({ autoDetect: false })).get(
		`${BOOK_PATH}/:slot`,
		async ({ params, headers, redirect, html }) => {
			const { url } = await bookService.resolve(params.slot);
			if (IOS.test(headers["user-agent"] ?? "")) {
				return html(openInFreshaPage(url));
			}
			return redirect(url, 302);
		},
		{ params: t.Object({ slot: t.String() }) },
	);
};
