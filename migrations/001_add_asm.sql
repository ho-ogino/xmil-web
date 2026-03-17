-- 既存環境用: shares テーブルに asm カラムを追加
-- Apply via: wrangler d1 execute x1pen-shares --remote --file=migrations/001_add_asm.sql

ALTER TABLE shares ADD COLUMN asm TEXT;
