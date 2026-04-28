-- PULSE system tables (run via: docker compose -f docker-compose.prod.yml exec -T postgres psql -U wp_user -d worldpulse_db < scripts/pulse-tables.sql)

-- 1. Publish log
CREATE TABLE IF NOT EXISTS pulse_publish_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id       UUID REFERENCES posts(id) ON DELETE CASCADE,
  content_type  VARCHAR(30) NOT NULL CHECK (content_type IN (
    'flash_brief', 'analysis', 'daily_briefing', 'social_thread', 'weekly_report', 'syndicated'
  )),
  source_signals UUID[] DEFAULT '{}',
  model_used    VARCHAR(100),
  token_count   INTEGER DEFAULT 0,
  generation_ms INTEGER DEFAULT 0,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata      JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_pulse_log_type ON pulse_publish_log(content_type);
CREATE INDEX IF NOT EXISTS idx_pulse_log_date ON pulse_publish_log(published_at DESC);

-- 2. Syndication tracking
CREATE TABLE IF NOT EXISTS pulse_syndication (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform      VARCHAR(20) NOT NULL CHECK (platform IN ('x', 'reddit', 'linkedin', 'hackernews')),
  external_id   VARCHAR(255),
  external_url  VARCHAR(512) NOT NULL,
  post_id       UUID REFERENCES posts(id) ON DELETE CASCADE,
  title         VARCHAR(500),
  engagement    JSONB DEFAULT '{}',
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pulse_synd_platform ON pulse_syndication(platform);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_synd_ext ON pulse_syndication(platform, external_id);

-- 3. Content queue
CREATE TABLE IF NOT EXISTS pulse_queue (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_type  VARCHAR(30) NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  payload       JSONB NOT NULL DEFAULT '{}',
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pulse_queue_status ON pulse_queue(status, priority DESC);

-- 4. Add pulse_content_type to posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pulse_content_type VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_posts_pulse_type ON posts(pulse_content_type) WHERE pulse_content_type IS NOT NULL;

-- Verify
SELECT 'pulse_publish_log' AS tbl, count(*) FROM pulse_publish_log
UNION ALL SELECT 'pulse_syndication', count(*) FROM pulse_syndication
UNION ALL SELECT 'pulse_queue', count(*) FROM pulse_queue;
