-- Migration 033: Add is_demo flag to communities
-- Lets us hide seeded/test communities from the public listing
-- without permanently deleting them (useful for testing in staging).
-- Run: docker exec wp_postgres psql -U wp_user -d worldpulse_db -c "ALTER TABLE communities ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;"

ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- Mark any communities created before the first real user signup as demo
-- (adjust the cutoff date to match your first real user's created_at)
-- UPDATE communities SET is_demo = true WHERE created_at < '2026-03-01';
