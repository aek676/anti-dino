import type { Migration } from "@/utils/db/types";

/** Where the conversations plugin keeps a chat's half-finished /remind. */
export const conversations: Migration = {
	name: "conversations",
	up: (db) => {
		db.run(`
			CREATE TABLE conversations (
				key TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);
	},
};
