import type { Migration } from "@/utils/db/types";

export const reminders: Migration = {
	name: "reminders",
	up: (db) => {
		db.run(`
			CREATE TABLE reminders (
				id INTEGER PRIMARY KEY,
				chat_id INTEGER NOT NULL,
				day TEXT NOT NULL,
				from_time TEXT NOT NULL,
				to_time TEXT NOT NULL,
				created_at TEXT NOT NULL,
				UNIQUE (chat_id, day, from_time, to_time)
			)
		`);
		db.run("CREATE INDEX reminders_day ON reminders (day)");
		db.run("ALTER TABLE subscribers ADD COLUMN only_reminders INTEGER");
	},
};
