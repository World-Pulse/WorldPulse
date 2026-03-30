-- Migration 032: signal_media table
-- Stores extracted multimedia items (YouTube videos, podcast audio) linked to signals.
-- Populated async during scrape pipeline; non-blocking on signal ingestion.

CREATE TABLE signal_media (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id     UUID        NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  media_type    TEXT        NOT NULL CHECK (media_type IN ('youtube', 'podcast_audio', 'video', 'iframe')),
  url           TEXT        NOT NULL,
  embed_id      TEXT,           -- YouTube video ID, etc.
  title         TEXT,
  duration_s    INTEGER,
  thumbnail_url TEXT,
  source_name   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_signal_media_signal_id ON signal_media(signal_id);
