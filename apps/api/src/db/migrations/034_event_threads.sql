-- 034: Event threads (related reports grouped into one developing story)
--
-- Already applied on the hosted database. For a new install: apply this file
-- by hand, like the other .sql files here (they are not run on deploy). The
-- public /api/v1/threads pages read these tables.
--
-- Until Oct 16, 2026 this file also added signals.embedding (OpenAI vectors).
-- Nothing uses that column any more: the in-house text fingerprints live in
-- signal_fingerprints, which the scraper creates itself on start
-- (apps/scraper/src/pipeline/fingerprints.ts).

CREATE TABLE IF NOT EXISTS event_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  summary         TEXT,
  category        VARCHAR(50),
  status          VARCHAR(20) NOT NULL DEFAULT 'developing',  -- developing, escalating, stable, resolved
  severity        VARCHAR(10) DEFAULT 'medium',
  region          VARCHAR(100),
  country_code    VARCHAR(2),
  signal_count    INT DEFAULT 1,
  first_signal_at TIMESTAMPTZ NOT NULL,
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_threads_status ON event_threads(status);
CREATE INDEX IF NOT EXISTS idx_event_threads_last_updated ON event_threads(last_updated DESC);
CREATE INDEX IF NOT EXISTS idx_event_threads_category ON event_threads(category);

CREATE TABLE IF NOT EXISTS event_thread_signals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES event_threads(id) ON DELETE CASCADE,
  signal_id   UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  relevance   DECIMAL(4,3) DEFAULT 1.000,
  UNIQUE(thread_id, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_ets_thread_id ON event_thread_signals(thread_id);
CREATE INDEX IF NOT EXISTS idx_ets_signal_id ON event_thread_signals(signal_id);
