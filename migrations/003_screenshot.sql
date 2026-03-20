-- Add screenshot_key column for OG image support
-- Apply via: wrangler d1 execute x1pen-shares --remote --file=migrations/003_screenshot.sql

ALTER TABLE shares ADD COLUMN screenshot_key TEXT;
