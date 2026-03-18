-- WorldPulse Database Schema
-- PostgreSQL 16 + PostGIS

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ─── ENUMS ──────────────────────────────────────────────────────────────
CREATE TYPE signal_severity AS ENUM ('critical', 'high', 'medium', 'low', 'info');
CREATE TYPE signal_status   AS ENUM ('pending', 'verified', 'disputed', 'false', 'retracted');
CREATE TYPE account_type    AS ENUM ('community', 'journalist', 'official', 'expert', 'ai', 'bot');
CREATE TYPE post_type       AS ENUM ('signal', 'thread', 'report', 'boost', 'deep_dive', 'poll');
CREATE TYPE source_tier     AS ENUM ('wire', 'national', 'regional', 'community', 'user');
CREATE TYPE category        AS ENUM (
  'breaking', 'conflict', 'geopolitics', 'climate', 'health',
  'economy', 'technology', 'science', 'elections', 'culture',
  'disaster', 'security', 'sports', 'space', 'other'
);

-- ─── USERS ──────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  handle          VARCHAR(50)  UNIQUE NOT NULL,
  display_name    VARCHAR(100) NOT NULL,
  email           VARCHAR(255) UNIQUE,
  password_hash   VARCHAR(255),
  bio             TEXT,
  avatar_url      VARCHAR(512),
  location        VARCHAR(100),
  website         VARCHAR(255),
  account_type    account_type NOT NULL DEFAULT 'community',
  trust_score     DECIMAL(4,3) NOT NULL DEFAULT 0.500 CHECK (trust_score BETWEEN 0 AND 1),
  follower_count  INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  signal_count    INTEGER NOT NULL DEFAULT 0,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at     TIMESTAMPTZ,
  verified_by     UUID REFERENCES users(id),
  suspended       BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_at    TIMESTAMPTZ,
  suspension_reason TEXT,
  oauth_github    VARCHAR(255) UNIQUE,
  oauth_google    VARCHAR(255) UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ
);

CREATE INDEX idx_users_handle     ON users(handle);
CREATE INDEX idx_users_trust      ON users(trust_score DESC);
CREATE INDEX idx_users_type       ON users(account_type);
CREATE INDEX idx_users_created    ON users(created_at DESC);
CREATE INDEX idx_users_search     ON users USING gin(display_name gin_trgm_ops);

-- ─── SOURCES ─────────────────────────────────────────────────────────────
CREATE TABLE sources (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            VARCHAR(100) UNIQUE NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  url             VARCHAR(512) NOT NULL,
  logo_url        VARCHAR(512),
  tier            source_tier NOT NULL DEFAULT 'community',
  trust_score     DECIMAL(4,3) NOT NULL DEFAULT 0.700 CHECK (trust_score BETWEEN 0 AND 1),
  language        CHAR(2) NOT NULL DEFAULT 'en',
  country         CHAR(2),
  categories      category[] NOT NULL DEFAULT '{}',
  rss_feeds       TEXT[] NOT NULL DEFAULT '{}',
  api_endpoint    VARCHAR(512),
  scrape_interval INTEGER NOT NULL DEFAULT 300, -- seconds
  last_scraped    TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  article_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sources_tier    ON sources(tier, trust_score DESC);
CREATE INDEX idx_sources_country ON sources(country);
CREATE INDEX idx_sources_active  ON sources(active) WHERE active = TRUE;

-- ─── SIGNALS ─────────────────────────────────────────────────────────────
-- The core entity: a verified world event
CREATE TABLE signals (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title             VARCHAR(500) NOT NULL,
  summary           TEXT,
  body              TEXT,
  category          category NOT NULL DEFAULT 'other',
  severity          signal_severity NOT NULL DEFAULT 'info',
  status            signal_status NOT NULL DEFAULT 'pending',
  reliability_score DECIMAL(4,3) NOT NULL DEFAULT 0.000 CHECK (reliability_score BETWEEN 0 AND 1),
  source_count      INTEGER NOT NULL DEFAULT 0,
  
  -- Geographic data
  location          GEOMETRY(POINT, 4326),  -- PostGIS point
  location_name     VARCHAR(255),
  country_code      CHAR(2),
  region            VARCHAR(100),
  
  -- Metadata
  tags              TEXT[] NOT NULL DEFAULT '{}',
  source_ids        UUID[] NOT NULL DEFAULT '{}',
  original_urls     TEXT[] NOT NULL DEFAULT '{}',
  language          CHAR(2) NOT NULL DEFAULT 'en',
  
  -- Engagement
  view_count        INTEGER NOT NULL DEFAULT 0,
  share_count       INTEGER NOT NULL DEFAULT 0,
  post_count        INTEGER NOT NULL DEFAULT 0,  -- number of posts referencing this signal
  
  -- Timing
  event_time        TIMESTAMPTZ,               -- when the event happened
  first_reported    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at       TIMESTAMPTZ,
  last_updated      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signals_category   ON signals(category, created_at DESC);
CREATE INDEX idx_signals_severity   ON signals(severity, created_at DESC);
CREATE INDEX idx_signals_status     ON signals(status) WHERE status = 'verified';
CREATE INDEX idx_signals_location   ON signals USING GIST(location);
CREATE INDEX idx_signals_country    ON signals(country_code, created_at DESC);
CREATE INDEX idx_signals_created    ON signals(created_at DESC);
CREATE INDEX idx_signals_event_time ON signals(event_time DESC);
CREATE INDEX idx_signals_tags       ON signals USING gin(tags);
CREATE INDEX idx_signals_text       ON signals USING gin(
  to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,''))
);

-- ─── POSTS ───────────────────────────────────────────────────────────────
-- User-generated content: posts, threads, reports
CREATE TABLE posts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_type       post_type NOT NULL DEFAULT 'signal',
  content         TEXT NOT NULL CHECK (char_length(content) <= 2000),
  
  -- Relations
  signal_id       UUID REFERENCES signals(id) ON DELETE SET NULL,  -- linked event
  parent_id       UUID REFERENCES posts(id) ON DELETE CASCADE,     -- reply to
  boost_of_id     UUID REFERENCES posts(id) ON DELETE SET NULL,    -- boost
  thread_root_id  UUID REFERENCES posts(id) ON DELETE CASCADE,     -- thread root
  
  -- Geographic
  location        GEOMETRY(POINT, 4326),
  location_name   VARCHAR(255),
  
  -- Media
  media_urls      TEXT[] NOT NULL DEFAULT '{}',
  media_types     TEXT[] NOT NULL DEFAULT '{}',
  
  -- Source attribution
  source_url      VARCHAR(512),
  source_name     VARCHAR(255),
  
  -- Tags
  tags            TEXT[] NOT NULL DEFAULT '{}',
  mentions        UUID[] NOT NULL DEFAULT '{}',  -- mentioned user IDs
  
  -- Engagement
  like_count      INTEGER NOT NULL DEFAULT 0,
  boost_count     INTEGER NOT NULL DEFAULT 0,
  reply_count     INTEGER NOT NULL DEFAULT 0,
  view_count      INTEGER NOT NULL DEFAULT 0,
  
  -- Quality
  reliability_score DECIMAL(4,3),
  flagged         BOOLEAN NOT NULL DEFAULT FALSE,
  flagged_reason  TEXT,
  
  -- Language
  language        CHAR(2) NOT NULL DEFAULT 'en',
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ  -- soft delete
);

CREATE INDEX idx_posts_author      ON posts(author_id, created_at DESC);
CREATE INDEX idx_posts_signal      ON posts(signal_id, created_at DESC);
CREATE INDEX idx_posts_parent      ON posts(parent_id, created_at DESC);
CREATE INDEX idx_posts_thread_root ON posts(thread_root_id, created_at DESC);
CREATE INDEX idx_posts_created     ON posts(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_posts_location    ON posts USING GIST(location);
CREATE INDEX idx_posts_tags        ON posts USING gin(tags);
CREATE INDEX idx_posts_text        ON posts USING gin(to_tsvector('english', content));

-- ─── FOLLOWS ─────────────────────────────────────────────────────────────
CREATE TABLE follows (
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id != following_id)
);

CREATE INDEX idx_follows_follower  ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);

-- ─── LIKES ───────────────────────────────────────────────────────────────
CREATE TABLE likes (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX idx_likes_post ON likes(post_id);
CREATE INDEX idx_likes_user ON likes(user_id, created_at DESC);

-- ─── BOOKMARKS ───────────────────────────────────────────────────────────
CREATE TABLE bookmarks (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

-- ─── ALERTS ──────────────────────────────────────────────────────────────
CREATE TABLE alert_subscriptions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  keywords      TEXT[] NOT NULL DEFAULT '{}',
  categories    category[] NOT NULL DEFAULT '{}',
  countries     CHAR(2)[] NOT NULL DEFAULT '{}',
  min_severity  signal_severity NOT NULL DEFAULT 'medium',
  channels      JSONB NOT NULL DEFAULT '{"email": true, "push": true, "in_app": true}',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_user ON alert_subscriptions(user_id) WHERE active = TRUE;

-- ─── NOTIFICATIONS ───────────────────────────────────────────────────────
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(50) NOT NULL,  -- 'like', 'reply', 'boost', 'follow', 'alert', 'mention'
  actor_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  post_id     UUID REFERENCES posts(id) ON DELETE CASCADE,
  signal_id   UUID REFERENCES signals(id) ON DELETE CASCADE,
  payload     JSONB NOT NULL DEFAULT '{}',
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_user    ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notif_unread  ON notifications(user_id) WHERE read = FALSE;

-- ─── SIGNAL SOURCES (junction) ───────────────────────────────────────────
CREATE TABLE signal_sources (
  signal_id   UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  article_url VARCHAR(512) NOT NULL,
  article_title VARCHAR(500),
  published_at TIMESTAMPTZ,
  PRIMARY KEY (signal_id, source_id)
);

-- ─── RAW ARTICLES (scraper staging) ──────────────────────────────────────
CREATE TABLE raw_articles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id    UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url          VARCHAR(512) UNIQUE NOT NULL,
  title        VARCHAR(500),
  body         TEXT,
  summary      TEXT,
  author       VARCHAR(255),
  published_at TIMESTAMPTZ,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed    BOOLEAN NOT NULL DEFAULT FALSE,
  signal_id    UUID REFERENCES signals(id) ON DELETE SET NULL,
  language     CHAR(2) DEFAULT 'en',
  word_count   INTEGER,
  hash         VARCHAR(64)  -- dedup hash
);

CREATE INDEX idx_articles_source     ON raw_articles(source_id, fetched_at DESC);
CREATE INDEX idx_articles_unprocessed ON raw_articles(processed) WHERE processed = FALSE;
CREATE INDEX idx_articles_hash       ON raw_articles(hash);

-- ─── COMMUNITIES ─────────────────────────────────────────────────────────
CREATE TABLE communities (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug         VARCHAR(100) UNIQUE NOT NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  avatar_url   VARCHAR(512),
  banner_url   VARCHAR(512),
  categories   category[] NOT NULL DEFAULT '{}',
  member_count INTEGER NOT NULL DEFAULT 0,
  post_count   INTEGER NOT NULL DEFAULT 0,
  public       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE community_members (
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         VARCHAR(20) NOT NULL DEFAULT 'member',  -- 'owner', 'mod', 'member'
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (community_id, user_id)
);

-- ─── VERIFICATION EVENTS ─────────────────────────────────────────────────
CREATE TABLE verification_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id   UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  check_type  VARCHAR(50) NOT NULL,  -- 'cross_source', 'ai_check', 'expert_review', 'community'
  result      VARCHAR(20) NOT NULL,  -- 'confirmed', 'disputed', 'false'
  confidence  DECIMAL(4,3),
  notes       TEXT,
  actor_id    UUID REFERENCES users(id),  -- NULL for automated
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_verify_signal ON verification_log(signal_id, created_at DESC);

-- ─── MODERATION ──────────────────────────────────────────────────────────
CREATE TABLE moderation_actions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  moderator_id UUID NOT NULL REFERENCES users(id),
  target_type  VARCHAR(20) NOT NULL,  -- 'post', 'user', 'signal'
  target_id    UUID NOT NULL,
  action       VARCHAR(50) NOT NULL,  -- 'remove', 'warn', 'suspend', 'label', 'reinstate'
  reason       TEXT NOT NULL,
  public_note  TEXT,
  reversed     BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Moderation log is intentionally fully public (open governance)
CREATE INDEX idx_mod_target ON moderation_actions(target_type, target_id, created_at DESC);
CREATE INDEX idx_mod_created ON moderation_actions(created_at DESC);

-- ─── POLLS ───────────────────────────────────────────────────────────────
CREATE TABLE polls (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     UUID REFERENCES posts(id) ON DELETE SET NULL,
  question    VARCHAR(500) NOT NULL,
  options     JSONB NOT NULL DEFAULT '[]',  -- [{text, votes}, ...]
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_polls_author  ON polls(author_id, created_at DESC);
CREATE INDEX idx_polls_post    ON polls(post_id) WHERE post_id IS NOT NULL;

CREATE TABLE poll_votes (
  poll_id      UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_index INTEGER NOT NULL CHECK (option_index BETWEEN 0 AND 3),
  voted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, user_id)
);

CREATE INDEX idx_poll_votes_poll ON poll_votes(poll_id);

-- ─── TRENDING ────────────────────────────────────────────────────────────
CREATE TABLE trending_topics (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tag        VARCHAR(100) NOT NULL,
  category   category,
  window     VARCHAR(20) NOT NULL DEFAULT '1h',  -- '1h', '6h', '24h'
  score      DECIMAL(10,2) NOT NULL DEFAULT 0,
  delta      DECIMAL(6,2) NOT NULL DEFAULT 0,  -- % change
  count      INTEGER NOT NULL DEFAULT 0,
  momentum   VARCHAR(20) NOT NULL DEFAULT 'steady',  -- 'surging', 'rising', 'steady', 'cooling'
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tag, window, snapshot_at)
);

CREATE INDEX idx_trending_window ON trending_topics(window, score DESC, snapshot_at DESC);

-- ─── FUNCTIONS ───────────────────────────────────────────────────────────
-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at   BEFORE UPDATE ON users   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER posts_updated_at   BEFORE UPDATE ON posts   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER signals_updated_at BEFORE UPDATE ON signals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER sources_updated_at BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-update follower/following counts
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET follower_count  = follower_count  + 1 WHERE id = NEW.following_id;
    UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET follower_count  = GREATEST(0, follower_count  - 1) WHERE id = OLD.following_id;
    UPDATE users SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER follows_count_trigger
AFTER INSERT OR DELETE ON follows
FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- Auto-update like counts
CREATE OR REPLACE FUNCTION update_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER likes_count_trigger
AFTER INSERT OR DELETE ON likes
FOR EACH ROW EXECUTE FUNCTION update_like_count();

-- ─── SEED DEFAULT SOURCES ────────────────────────────────────────────────
INSERT INTO sources (slug, name, url, tier, trust_score, language, country, categories, rss_feeds, scrape_interval) VALUES
  -- Wire services (original)
  ('ap-news',      'AP News',             'https://apnews.com',              'wire',     0.97, 'en', 'US', '{breaking,geopolitics,economy}', '{https://apnews.com/rss}',                                                              900),
  ('reuters',      'Reuters',             'https://reuters.com',             'wire',     0.96, 'en', 'GB', '{breaking,economy,geopolitics}', '{https://feeds.reuters.com/reuters/topNews}',                                           900),
  ('bbc-world',    'BBC World',           'https://bbc.com/news/world',      'wire',     0.95, 'en', 'GB', '{breaking,geopolitics,culture}', '{http://feeds.bbci.co.uk/news/world/rss.xml}',                                         900),
  ('afp',          'AFP',                 'https://www.afp.com',             'wire',     0.95, 'en', 'FR', '{breaking,geopolitics}',         '{}',                                                                                    900),
  ('al-jazeera',   'Al Jazeera',          'https://aljazeera.com',           'national', 0.88, 'en', 'QA', '{geopolitics,conflict,culture}', '{https://www.aljazeera.com/xml/rss/all.xml}',                                          1200),
  ('guardian',     'The Guardian',        'https://theguardian.com',         'national', 0.87, 'en', 'GB', '{climate,science,geopolitics}',  '{https://www.theguardian.com/world/rss}',                                              1200),
  ('nyt',          'New York Times',      'https://nytimes.com',             'national', 0.89, 'en', 'US', '{breaking,geopolitics,economy}', '{}',                                                                                    1200),
  ('dw',           'Deutsche Welle',      'https://dw.com',                  'national', 0.88, 'en', 'DE', '{geopolitics,economy,culture}',  '{https://rss.dw.com/rdf/rss-en-all}',                                                  1200),
  ('nhk-world',    'NHK World',           'https://nhk.or.jp/nhkworld',      'national', 0.90, 'en', 'JP', '{breaking,geopolitics}',         '{https://www3.nhk.or.jp/rss/news/cat0.xml}',                                          1200),
  ('usgs-quakes',  'USGS Earthquakes',    'https://earthquake.usgs.gov',     'wire',     0.99, 'en', 'US', '{disaster}',                     '{https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.atom}',             300),
  ('noaa-alerts',  'NOAA Weather',        'https://weather.gov',             'wire',     0.99, 'en', 'US', '{climate,disaster}',             '{}',                                                                                    600),
  ('who',          'World Health Org.',   'https://who.int',                 'wire',     0.98, 'en', 'CH', '{health}',                       '{https://www.who.int/rss-feeds/news-english.xml}',                                     1800),
  ('nasa-news',    'NASA',                'https://nasa.gov',                'wire',     0.99, 'en', 'US', '{science,space}',                '{https://www.nasa.gov/rss/dyn/breaking_news.rss}',                                     1800),
  ('acled',        'ACLED Conflict Data', 'https://acleddata.com',           'wire',     0.96, 'en', 'CH', '{conflict}',                     '{}',                                                                                    3600),

  -- Wire services (new)
  ('bloomberg',        'Bloomberg',                   'https://bloomberg.com',               'wire',     0.93, 'en', 'US', '{economy,breaking,technology}',   '{https://feeds.bloomberg.com/markets/news.rss}',                           900),
  ('xinhua',           'Xinhua News Agency',          'https://xinhuanet.com',               'wire',     0.80, 'en', 'CN', '{geopolitics,economy,breaking}',   '{https://www.xinhuanet.com/english/rss/worldrss.xml}',                     900),
  ('tass',             'TASS',                        'https://tass.com',                    'wire',     0.75, 'en', 'RU', '{geopolitics,breaking,conflict}',  '{https://tass.com/rss/v2.xml}',                                           1200),
  ('ani',              'ANI News',                    'https://aninews.in',                  'wire',     0.82, 'en', 'IN', '{breaking,geopolitics,economy}',   '{https://aninews.in/rss/world.xml}',                                       1200),

  -- Middle East
  ('al-monitor',       'Al-Monitor',                  'https://al-monitor.com',              'regional', 0.85, 'en', 'US', '{geopolitics,conflict,culture}',   '{https://www.al-monitor.com/rss}',                                        1800),
  ('the-national-uae', 'The National (UAE)',           'https://thenationalnews.com',         'regional', 0.84, 'en', 'AE', '{geopolitics,economy,culture}',    '{https://www.thenationalnews.com/arc/outboundfeeds/rss/}',                 1800),
  ('arab-news',        'Arab News',                   'https://arabnews.com',                'regional', 0.82, 'en', 'SA', '{geopolitics,economy,culture}',    '{https://www.arabnews.com/rss.xml}',                                       1800),
  ('jerusalem-post',   'The Jerusalem Post',          'https://jpost.com',                   'regional', 0.82, 'en', 'IL', '{geopolitics,conflict,politics}',  '{https://www.jpost.com/rss/rssfeedsfrontpage.aspx}',                       1800),
  ('haaretz',          'Haaretz',                     'https://haaretz.com',                 'regional', 0.86, 'en', 'IL', '{geopolitics,politics,conflict}',  '{https://www.haaretz.com/rss}',                                            1800),
  ('daily-sabah',      'Daily Sabah',                 'https://dailysabah.com',              'regional', 0.78, 'en', 'TR', '{geopolitics,economy,culture}',    '{https://www.dailysabah.com/rss}',                                         1800),

  -- Africa
  ('allafrica',        'AllAfrica',                   'https://allafrica.com',               'regional', 0.79, 'en', 'ZA', '{geopolitics,health,economy}',     '{https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf}',         2400),
  ('east-african',     'The East African',            'https://theeastafrican.co.ke',        'regional', 0.82, 'en', 'KE', '{economy,geopolitics,politics}',   '{https://www.theeastafrican.co.ke/rss}',                                   2400),
  ('daily-nation-ke',  'Daily Nation Kenya',          'https://nation.africa',               'regional', 0.81, 'en', 'KE', '{breaking,politics,economy}',      '{https://nation.africa/kenya/rss.xml}',                                    1800),
  ('premium-times-ng', 'Premium Times Nigeria',       'https://premiumtimesng.com',          'regional', 0.80, 'en', 'NG', '{politics,economy,breaking}',      '{https://www.premiumtimesng.com/feed}',                                    1800),
  ('mail-guardian-za', 'Mail & Guardian (S.Africa)',  'https://mg.co.za',                    'regional', 0.83, 'en', 'ZA', '{politics,economy,culture}',       '{https://mg.co.za/feed}',                                                  2400),

  -- Asia-Pacific
  ('scmp',             'South China Morning Post',    'https://scmp.com',                    'national', 0.86, 'en', 'HK', '{geopolitics,economy,technology}', '{https://www.scmp.com/rss/91/feed}',                                       1200),
  ('the-hindu',        'The Hindu',                   'https://thehindu.com',                'national', 0.87, 'en', 'IN', '{geopolitics,politics,economy}',   '{https://www.thehindu.com/news/national/feeder/default.rss}',              1200),
  ('dawn-pk',          'Dawn (Pakistan)',              'https://dawn.com',                    'regional', 0.82, 'en', 'PK', '{geopolitics,politics,economy}',   '{https://www.dawn.com/feeds/home}',                                        1800),
  ('straits-times',    'The Straits Times',           'https://straitstimes.com',            'national', 0.87, 'en', 'SG', '{geopolitics,economy,technology}', '{https://www.straitstimes.com/news/asia/rss.xml}',                         1200),
  ('abc-australia',    'ABC Australia',               'https://abc.net.au/news',             'national', 0.90, 'en', 'AU', '{breaking,geopolitics,climate}',   '{https://www.abc.net.au/news/feed/2942460/rss.xml}',                       1200),
  ('japan-times',      'The Japan Times',             'https://japantimes.co.jp',            'regional', 0.86, 'en', 'JP', '{geopolitics,economy,culture}',    '{https://www.japantimes.co.jp/feed/}',                                     1800),
  ('korea-herald',     'The Korea Herald',            'https://koreaherald.com',             'regional', 0.83, 'en', 'KR', '{geopolitics,economy,politics}',   '{https://www.koreaherald.com/rss/0200000000.xml}',                         1800),

  -- Latin America
  ('elpais-en',        'El País (English)',            'https://english.elpais.com',          'national', 0.88, 'en', 'ES', '{geopolitics,politics,culture}',   '{https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada}',1800),
  ('folha-en',         'Folha de S.Paulo',             'https://www1.folha.uol.com.br',       'national', 0.84, 'pt', 'BR', '{politics,economy,culture}',       '{https://feeds.folha.uol.com.br/folha/mundo/rss091.xml}',                  1800),
  ('buenos-aires-herald','Buenos Aires Herald',        'https://buenosairesherald.com',       'regional', 0.80, 'en', 'AR', '{politics,economy,culture}',       '{https://buenosairesherald.com/feed}',                                     2400),
  ('insight-crime',    'InSight Crime',                'https://insightcrime.org',            'regional', 0.85, 'en', 'CO', '{conflict,security,geopolitics}',  '{https://insightcrime.org/feed/}',                                         2400),

  -- Europe
  ('euobserver',       'EUobserver',                  'https://euobserver.com',              'regional', 0.85, 'en', 'BE', '{geopolitics,politics,economy}',   '{https://euobserver.com/rss.xml}',                                         1800),
  ('politico-eu',      'Politico Europe',             'https://politico.eu',                 'national', 0.87, 'en', 'BE', '{politics,geopolitics,economy}',   '{https://www.politico.eu/feed/}',                                          1200),
  ('france24',         'France 24 (English)',          'https://france24.com/en',             'national', 0.88, 'en', 'FR', '{breaking,geopolitics,culture}',   '{https://www.france24.com/en/rss}',                                        900),
  ('rfi-english',      'RFI English',                 'https://rfi.fr/en',                   'national', 0.86, 'en', 'FR', '{geopolitics,culture,breaking}',   '{https://www.rfi.fr/en/rss}',                                              1200),
  ('euronews',         'Euronews',                    'https://euronews.com',                'national', 0.84, 'en', 'FR', '{breaking,geopolitics,economy}',   '{https://www.euronews.com/rss?level=theme&name=news}',                     1200),

  -- Humanitarian / Aid
  ('reliefweb',        'ReliefWeb',                   'https://reliefweb.int',               'wire',     0.93, 'en', 'CH', '{health,disaster,conflict}',       '{https://reliefweb.int/updates/rss.xml}',                                  3600),
  ('ocha',             'UN OCHA',                     'https://unocha.org',                  'wire',     0.95, 'en', 'CH', '{health,disaster,conflict}',       '{https://www.unocha.org/rss.xml}',                                         3600),
  ('msf',              'Médecins Sans Frontières',    'https://msf.org',                     'wire',     0.94, 'en', 'CH', '{health,conflict,disaster}',       '{https://www.msf.org/rss.xml}',                                            3600),
  ('crisis-group',     'International Crisis Group',  'https://crisisgroup.org',             'regional', 0.92, 'en', 'BE', '{conflict,geopolitics,security}',  '{https://www.crisisgroup.org/rss.xml}',                                    3600),

  -- Climate / Environment
  ('carbon-brief',     'Carbon Brief',                'https://carbonbrief.org',             'regional', 0.91, 'en', 'GB', '{climate,science,technology}',     '{https://www.carbonbrief.org/feed}',                                       3600),
  ('yale-e360',        'Yale Environment 360',        'https://e360.yale.edu',               'regional', 0.90, 'en', 'US', '{climate,science,technology}',     '{https://e360.yale.edu/feed}',                                             3600),

  -- Technology
  ('mit-tech-review',  'MIT Technology Review',       'https://technologyreview.com',        'regional', 0.88, 'en', 'US', '{technology,science,economy}',     '{https://www.technologyreview.com/feed/}',                                 2400),
  ('wired',            'Wired',                       'https://wired.com',                   'regional', 0.83, 'en', 'US', '{technology,science,security}',    '{https://www.wired.com/feed/rss}',                                         1800),
  ('ars-technica',     'Ars Technica',                'https://arstechnica.com',             'regional', 0.85, 'en', 'US', '{technology,science,security}',    '{https://feeds.arstechnica.com/arstechnica/index}',                        1800),

  -- Foreign Policy / Geopolitics
  ('foreign-policy',   'Foreign Policy',              'https://foreignpolicy.com',           'regional', 0.88, 'en', 'US', '{geopolitics,security,politics}',  '{https://foreignpolicy.com/feed/}',                                        2400),
  ('the-diplomat',     'The Diplomat',                'https://thediplomat.com',             'regional', 0.87, 'en', 'JP', '{geopolitics,politics,economy}',   '{https://thediplomat.com/feed/}',                                          2400),
  ('war-on-rocks',     'War on the Rocks',            'https://warontherocks.com',           'regional', 0.86, 'en', 'US', '{conflict,security,geopolitics}',  '{https://warontherocks.com/feed/}',                                        3600),

  -- Science / Health
  ('our-world-data',   'Our World in Data',           'https://ourworldindata.org',          'regional', 0.93, 'en', 'GB', '{health,climate,economy}',         '{https://ourworldindata.org/atom.xml}',                                    3600),
  ('lancet-news',      'The Lancet',                  'https://thelancet.com',               'regional', 0.95, 'en', 'GB', '{health,science}',                 '{https://www.thelancet.com/rssfeed/lancet_online.xml}',                    3600),
  ('nature-news',      'Nature News',                 'https://nature.com/news',             'regional', 0.96, 'en', 'GB', '{science,health,climate}',         '{https://www.nature.com/nature.rss}',                                      3600),

  -- Development / Global Affairs
  ('devex',            'Devex',                       'https://devex.com',                   'regional', 0.84, 'en', 'US', '{health,economy,geopolitics}',     '{https://www.devex.com/news/rss.xml}',                                     3600),
  ('quartz-africa',    'Quartz Africa',               'https://qz.com/africa',               'regional', 0.82, 'en', 'US', '{economy,technology,culture}',     '{https://cms.qz.com/feed/}',                                               3600),

  -- Community / Social
  ('reddit-worldnews', 'Reddit r/worldnews',          'https://reddit.com/r/worldnews',      'community',0.65, 'en', 'US', '{breaking,geopolitics,conflict}',  '{https://www.reddit.com/r/worldnews/.rss}',                                1800),
  ('reddit-news',      'Reddit r/news',               'https://reddit.com/r/news',           'community',0.62, 'en', 'US', '{breaking,geopolitics}',           '{https://www.reddit.com/r/news/.rss}',                                     1800),
  ('bellingcat',       'Bellingcat',                  'https://bellingcat.com',              'regional', 0.90, 'en', 'NL', '{conflict,security,technology}',   '{https://www.bellingcat.com/feed/}',                                       3600);

-- ─── SOURCE SUGGESTIONS ──────────────────────────────────────────────────
CREATE TABLE source_suggestions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  name        VARCHAR(255) NOT NULL,
  url         VARCHAR(512) NOT NULL,
  rss_url     VARCHAR(512),
  category    category NOT NULL DEFAULT 'other',
  reason      TEXT NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_source_suggestions_status  ON source_suggestions(status, created_at DESC);
CREATE INDEX idx_source_suggestions_user    ON source_suggestions(user_id);

-- ─── DEVICE PUSH TOKENS ──────────────────────────────────────────────────
CREATE TABLE device_push_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(512) NOT NULL,
  platform    VARCHAR(20) NOT NULL DEFAULT 'expo', -- 'expo', 'fcm', 'apns'
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, token)
);

CREATE INDEX idx_device_tokens_user ON device_push_tokens(user_id) WHERE active = TRUE;

-- ─── SEED AI DIGEST USER ─────────────────────────────────────────────────
INSERT INTO users (handle, display_name, account_type, verified, trust_score, bio) VALUES
  ('worldpulse_ai', 'WorldPulse AI Digest', 'ai', TRUE, 0.950, 'Automated synthesis of verified global signals. Powered by open-source AI.');
