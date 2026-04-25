-- bunq Aether — initial schema.
-- Written for SQLite + MariaDB portability.
-- Conventions:
--   * IDs are TEXT (UUID) — identical on both engines, no AUTO_INCREMENT coupling.
--   * Timestamps are INTEGER epoch-ms — tiny, fast, timezone-free.
--   * JSON is stored as TEXT — we validate in the service layer.
--   * `user_id` is on every row for future multi-tenancy even though we run single-user today.
--
-- Tables:
--   conversations         — every AI turn (input → output)
--   conversation_actions  — actions the AI proposed in a given turn
--   action_log            — every action actually dispatched (side effects executed)
--   user_traits           — learned preferences ("prefers weekly sweeps", "risk tolerance=low")
--   merchant_memory       — user-specific overrides for merchant category/recurrence
--   ai_cache              — L2 response cache

CREATE TABLE IF NOT EXISTS conversations (
  id               VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id          VARCHAR(64)  NOT NULL,
  ts               BIGINT       NOT NULL,
  voice_text       TEXT         NULL,
  emotional_tone   VARCHAR(32)  NULL,
  scene            TEXT         NULL,
  risk             VARCHAR(16)  NULL,
  voice_response   TEXT         NULL,
  insight          TEXT         NULL,
  provider         VARCHAR(32)  NULL,
  latency_ms       INTEGER      NULL,
  cache_hit        INTEGER      NOT NULL DEFAULT 0,
  tokens_in        INTEGER      NULL,
  tokens_out       INTEGER      NULL,
  intent           VARCHAR(64)  NULL
);

CREATE INDEX IF NOT EXISTS idx_conv_user_ts ON conversations (user_id, ts);

CREATE TABLE IF NOT EXISTS conversation_actions (
  id              VARCHAR(64)  NOT NULL PRIMARY KEY,
  conversation_id VARCHAR(64)  NOT NULL,
  user_id         VARCHAR(64)  NOT NULL,
  action_type     VARCHAR(64)  NOT NULL,
  action_json     TEXT         NOT NULL,
  accepted        INTEGER      NOT NULL DEFAULT 0,  -- 1 if user confirmed, 0 if declined or pending
  ts              BIGINT       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_convact_conv ON conversation_actions (conversation_id);
CREATE INDEX IF NOT EXISTS idx_convact_user ON conversation_actions (user_id, ts);

CREATE TABLE IF NOT EXISTS action_log (
  id              VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id         VARCHAR(64)  NOT NULL,
  ts              BIGINT       NOT NULL,
  type            VARCHAR(64)  NOT NULL,
  status          VARCHAR(16)  NOT NULL,        -- executing | completed | failed | undone
  amount          DECIMAL(18,2) NULL,
  from_account    VARCHAR(128) NULL,
  to_account      VARCHAR(128) NULL,
  description     TEXT         NULL,
  snapshot_json   TEXT         NULL,
  result_json     TEXT         NULL,
  error           TEXT         NULL,
  idempotency_key VARCHAR(128) NULL
);

CREATE INDEX IF NOT EXISTS idx_actlog_user_ts   ON action_log (user_id, ts);
CREATE INDEX IF NOT EXISTS idx_actlog_user_idem ON action_log (user_id, idempotency_key);

CREATE TABLE IF NOT EXISTS user_traits (
  user_id     VARCHAR(64)  NOT NULL,
  trait_key   VARCHAR(64)  NOT NULL,
  trait_value TEXT         NOT NULL,
  confidence  REAL         NOT NULL DEFAULT 0.5,
  last_seen   BIGINT       NOT NULL,
  updated_at  BIGINT       NOT NULL,
  PRIMARY KEY (user_id, trait_key)
);

CREATE TABLE IF NOT EXISTS merchant_memory (
  user_id           VARCHAR(64)  NOT NULL,
  merchant_slug     VARCHAR(128) NOT NULL,
  display_name      VARCHAR(200) NULL,
  category_override VARCHAR(64)  NULL,
  is_recurring      INTEGER      NOT NULL DEFAULT 0,
  avg_amount        DECIMAL(18,2) NULL,
  seen_count        INTEGER      NOT NULL DEFAULT 1,
  last_seen         BIGINT       NOT NULL,
  PRIMARY KEY (user_id, merchant_slug)
);

CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key    CHAR(64)    NOT NULL PRIMARY KEY,
  user_id      VARCHAR(64) NOT NULL,
  response_json TEXT       NOT NULL,
  provider     VARCHAR(32) NULL,
  created_at   BIGINT      NOT NULL,
  expires_at   BIGINT      NOT NULL,
  hit_count    INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cache_expires ON ai_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_user    ON ai_cache (user_id);
