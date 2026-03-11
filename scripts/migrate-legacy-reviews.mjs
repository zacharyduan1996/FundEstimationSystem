#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "fund-valuation.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS fund_review_notes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    review_date TEXT NOT NULL,
    expectation TEXT NOT NULL,
    result TEXT NOT NULL,
    reason TEXT NOT NULL,
    action_plan TEXT NOT NULL,
    record_kind TEXT NOT NULL DEFAULT 'legacy',
    source_checklist_item_id TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const columns = db.prepare("PRAGMA table_info(fund_review_notes)").all();
const names = new Set(columns.map((column) => column.name));
if (!names.has("record_kind")) {
  db.exec("ALTER TABLE fund_review_notes ADD COLUMN record_kind TEXT NOT NULL DEFAULT 'legacy'");
}
if (!names.has("source_checklist_item_id")) {
  db.exec("ALTER TABLE fund_review_notes ADD COLUMN source_checklist_item_id TEXT");
}
if (!names.has("title")) {
  db.exec("ALTER TABLE fund_review_notes ADD COLUMN title TEXT NOT NULL DEFAULT ''");
}

const updated = db
  .prepare(
    `
    UPDATE fund_review_notes
    SET record_kind = 'legacy'
    WHERE record_kind IS NULL
       OR TRIM(record_kind) = ''
       OR record_kind NOT IN ('legacy', 'decision')
    `
  )
  .run().changes;

const titled = db
  .prepare(
    `
    UPDATE fund_review_notes
    SET title = substr(COALESCE(NULLIF(TRIM(result), ''), '历史复盘'), 1, 60)
    WHERE title IS NULL OR TRIM(title) = ''
    `
  )
  .run().changes;

console.log(`[migrate-legacy-reviews] database=${dbPath}`);
console.log(`[migrate-legacy-reviews] normalized_rows=${updated}`);
console.log(`[migrate-legacy-reviews] backfilled_title_rows=${titled}`);

db.close();
