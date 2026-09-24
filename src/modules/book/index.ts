import { Elysia, t } from "elysia";
import { openInFreshaPage } from "./page";
import { type BookDeps, createBookService } from "./service";

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

	return new Elysia({ name: "book" }).get(
		`${BOOK_PATH}/:slot`,
		async ({ params, headers, redirect }) => {
			const { url } = await bookService.resolve(params.slot);
			if (IOS.test(headers["user-agent"] ?? "")) {
				return new Response(openInFreshaPage(url), {
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			}
			return redirect(url, 302);
		},
		{ params: t.Object({ slot: t.String() }) },
	);
};
