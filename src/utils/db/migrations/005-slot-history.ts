import type { Migration } from "@/utils/db/types";

export const slotHistory: Migration = {
	name: "slot-history",
	up: (db) => {
		db.run(`
			CREATE TABLE slots_new (
				employee_id TEXT NOT NULL,
				service_id TEXT NOT NULL,
				starts_at TEXT NOT NULL,
				seen_at TEXT NOT NULL,
				last_seen_at TEXT NOT NULL,
				gone_at TEXT,
				PRIMARY KEY (employee_id, service_id, starts_at, seen_at)
			)
		`);
		db.run(`
			INSERT INTO slots_new
			SELECT employee_id, service_id, starts_at, seen_at, seen_at, NULL FROM slots
		`);
		db.run("DROP TABLE slots");
		db.run("ALTER TABLE slots_new RENAME TO slots");
		db.run(`
			CREATE UNIQUE INDEX slots_live ON slots (employee_id, service_id, starts_at)
			WHERE gone_at IS NULL
		`);
	},
};
