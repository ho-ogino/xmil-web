-- X1Pen Share: D1 schema (新規構築用)
-- Apply via: wrangler d1 execute x1pen-shares --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    codec TEXT NOT NULL,
    raw_size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
