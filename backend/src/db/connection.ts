import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type Db = Database.Database;

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const APP_DB_PATH = fileURLToPath(new URL("../../data/app.db", import.meta.url));

export function openDatabase(filename: string): Db {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // INSERT OR REPLACE deletes the conflicting row before inserting, and SQLite
  // only fires delete triggers for that delete when recursive triggers are on.
  // Without this, REPLACE could overwrite an audit row past the append-only trigger.
  db.pragma("recursive_triggers = ON");
  db.exec(schema);
  return db;
}

// backend/data is gitignored, so it does not exist on a fresh clone.
export function openAppDatabase(): Db {
  mkdirSync(dirname(APP_DB_PATH), { recursive: true });
  return openDatabase(APP_DB_PATH);
}
