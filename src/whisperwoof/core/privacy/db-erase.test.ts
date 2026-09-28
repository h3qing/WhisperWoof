/**
 * Deleting must erase: with encryption off, a clipboard password the user
 * deleted must not be readable from the database file or its search index.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3-multiple-ciphers");
const { enableSecureDelete, checkpoint } = require("../../bridge/db-erase.js");

const SECRET = "hunter2secretXYZ";
let dir = "";
let file = "";

function schema(db: any) {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, raw_text TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(raw_text, content='entries', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
      INSERT INTO entries_fts(rowid, raw_text) VALUES (new.id, new.raw_text);
    END;
    CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, raw_text) VALUES ('delete', old.id, old.raw_text);
    END;
  `);
}

function fill(db: any) {
  const insert = db.prepare("INSERT INTO entries (raw_text) VALUES (?)");
  for (let i = 0; i < 200; i++) insert.run(i === 50 ? `password is ${SECRET}` : `ordinary note ${i} `.repeat(20));
}

function fileHasSecret() {
  return [file, `${file}-wal`].some(
    (p) => fs.existsSync(p) && fs.readFileSync(p).includes(Buffer.from(SECRET))
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-erase-"));
  file = path.join(dir, "t.db");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("enableSecureDelete", () => {
  it("leaves nothing of a deleted row in the file, the WAL or the index", () => {
    const db = new Database(file);
    schema(db);
    enableSecureDelete(db, ["entries_fts"]);
    fill(db);
    checkpoint(db);
    expect(fileHasSecret()).toBe(true);

    db.prepare("DELETE FROM entries WHERE raw_text LIKE ?").run(`%${SECRET}%`);
    checkpoint(db);
    db.close();
    expect(fileHasSecret()).toBe(false);
  });

  it("scrubs what was deleted before it was turned on, once", () => {
    const db = new Database(file);
    schema(db);
    fill(db);
    db.prepare("DELETE FROM entries WHERE raw_text LIKE ?").run(`%${SECRET}%`);
    checkpoint(db);
    expect(fileHasSecret()).toBe(true); // the old behaviour: still on disk

    expect(enableSecureDelete(db, ["entries_fts"])).toBe(true);
    expect(enableSecureDelete(db, ["entries_fts"])).toBe(false);
    db.close();
    expect(fileHasSecret()).toBe(false);
  });

  it("keeps search working", () => {
    const db = new Database(file);
    schema(db);
    enableSecureDelete(db, ["entries_fts"]);
    fill(db);
    expect(db.prepare("SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?").all("ordinary").length).toBe(199);
    db.close();
  });
});
