import type { Migration } from "@/utils/db/types";

export const subscriberNotify: Migration = {
	name: "subscriber-notify",
	up: (db) => {
		db.run(
			"ALTER TABLE subscribers ADD COLUMN notify INTEGER NOT NULL DEFAULT 1",
		);
		db.run("ALTER TABLE subscribers ADD COLUMN updated_at TEXT");
	},
};
