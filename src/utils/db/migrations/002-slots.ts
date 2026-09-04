import type { Migration } from "@/utils/db/types";

export const slots: Migration = {
	name: "slots",
	up: (db) => {
		db.run(`
			CREATE TABLE slots (
				employee_id TEXT NOT NULL,
				service_id TEXT NOT NULL,
				starts_at TEXT NOT NULL,
				seen_at TEXT NOT NULL,
				PRIMARY KEY (employee_id, service_id, starts_at)
			)
		`);
	},
};
