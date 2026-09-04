import { migrations } from "@/utils/db/migrations";
import type { Db } from "@/utils/db/types";
import { log } from "@/utils/logger";

export const SCHEMA_VERSION = migrations.length;

type VersionRow = { user_version: number };

export const schemaVersion = (db: Db): number =>
	db.query<VersionRow, []>("PRAGMA user_version").get()?.user_version ?? 0;

export const migrate = (db: Db): void => {
	const applied = schemaVersion(db);
	const pending = migrations.slice(applied);
	if (pending.length === 0) return;

	db.transaction(() => {
		for (const [index, migration] of pending.entries()) {
			const version = applied + index + 1;
			log.debug({ version, migration: migration.name }, "applying migration");
			migration.up(db);
			db.run(`PRAGMA user_version = ${version}`);
		}
	})();
};
