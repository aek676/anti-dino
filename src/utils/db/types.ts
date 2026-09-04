import type { Database } from "bun:sqlite";

export type Db = Database;

export type Migration = {
	name: string;
	up: (db: Db) => void;
};
