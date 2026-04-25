-- Add session threading so the AI sees real multi-turn conversation history,
-- not just a text summary of unrelated past turns.
--
-- A session groups consecutive turns the user considers "one conversation".
-- The client generates a sessionId (persists in sessionStorage) and passes it
-- with every /api/ai/analyse request. Server loads prior turns in the same
-- session to build a proper `messages` array for the provider.

ALTER TABLE conversations ADD COLUMN session_id VARCHAR(64) NULL;

CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations (user_id, session_id, ts);
