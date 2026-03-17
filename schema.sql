-- X1Pen Share: D1 schema
-- Apply via Cloudflare dashboard or: wrangler d1 execute x1pen-shares --file=schema.sql

CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    basic TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
