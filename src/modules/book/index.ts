import { Elysia, t } from "elysia";
import { type BookDeps, createBookService } from "./service";

export { type BookOutcome, parseSlot } from "./model";
export { type BookDeps, type BookResult, createBookService } from "./service";

export const book = (deps: BookDeps) => {
	const bookService = createBookService(deps);

	return new Elysia({ name: "book" }).get(
		"/book/:slot",
		async ({ params, redirect }) => {
			const { url } = await bookService.resolve(params.slot);
			return redirect(url, 302);
		},
		{ params: t.Object({ slot: t.String() }) },
	);
};
