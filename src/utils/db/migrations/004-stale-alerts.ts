import type { Migration } from "@/utils/db/types";

export const staleAlerts: Migration = {
	name: "stale-alerts",
	up: (db) => {
		db.run("ALTER TABLE alerts ADD COLUMN stale INTEGER NOT NULL DEFAULT 0");
	},
};
