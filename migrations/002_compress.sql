-- 既存テーブルを破棄して gzip BLOB 形式に移行
-- Apply via: wrangler d1 execute x1pen-shares --remote --file=migrations/002_compress.sql

DROP TABLE IF EXISTS shares;
CREATE TABLE shares (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    codec TEXT NOT NULL,
    raw_size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
