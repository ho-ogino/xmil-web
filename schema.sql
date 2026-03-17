-- X1Pen Share: D1 schema (新規構築用)
-- Apply via: wrangler d1 execute x1pen-shares --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    basic TEXT NOT NULL,
    asm TEXT,
    created_at INTEGER NOT NULL
);
