-- WorldPulse Production Migration: NWS Title/Location Overflow Fix
-- Date: 2026-04-15
-- Purpose: Widen title columns from VARCHAR(500) to TEXT to prevent
--   NWS alerts failing with "value too long for type character varying(500)"
-- Run via: type infrastructure\docker\postgres\migration_nws_overflow.sql | ssh root@142.93.71.102 "docker exec -i wp_postgres psql -U wp_user -d worldpulse_db"

-- Signals table: title is the primary overflow culprit
ALTER TABLE signals ALTER COLUMN title TYPE TEXT;

-- NOTE: raw_articles.article_title and trending_topics.title do not exist in prod schema.
-- Only signals.title needed widening. Applied successfully Apr 15.
-- Verify: \d signals (title should be TEXT)
