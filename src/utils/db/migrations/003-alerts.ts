import type { Migration } from "@/utils/db/types";

export const alerts: Migration = {
	name: "alerts",
	up: (db) => {
		db.run(`
			CREATE TABLE alerts (
				chat_id INTEGER NOT NULL,
				message_id INTEGER NOT NULL,
				employee_id TEXT NOT NULL,
				service_id TEXT NOT NULL,
				starts_at TEXT NOT NULL,
				PRIMARY KEY (chat_id, message_id, employee_id, service_id, starts_at)
			)
		`);
	},
};
