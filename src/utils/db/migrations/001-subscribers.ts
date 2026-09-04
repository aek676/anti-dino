import type { Migration } from "@/utils/db/types";

export const subscribers: Migration = {
	name: "subscribers",
	up: (db) => {
		db.run(`
			CREATE TABLE subscribers (
				chat_id INTEGER PRIMARY KEY,
				created_at TEXT NOT NULL
			)
		`);
	},
};
