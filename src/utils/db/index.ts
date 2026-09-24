import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate, schemaVersion } from "@/utils/db/migrate";
import type { Db } from "@/utils/db/types";
import { log } from "@/utils/logger";

export type { Db } from "@/utils/db/types";

const MEMORY = ":memory:";

export const connectDatabase = (path: string): Db => {
	if (path !== MEMORY) mkdirSync(dirname(path), { recursive: true });

	const db = new Database(path, { create: true, strict: true });
	db.run("PRAGMA journal_mode = WAL");
	db.run("PRAGMA busy_timeout = 5000");
	db.run("PRAGMA foreign_keys = ON");
	return db;
};

export const openDatabase = (path: string): Db => {
	const db = connectDatabase(path);

	migrate(db);
	log.info({ path, version: schemaVersion(db) }, "database ready");
	return db;
};

export const closeDatabase = (db: Db): void => {
	db.close();
	log.info("database closed");
};
