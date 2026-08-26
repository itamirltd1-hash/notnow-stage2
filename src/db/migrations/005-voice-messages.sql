-- ============================================================================
-- Voice notes
-- ============================================================================
-- A voice note carries the scheduling command AND, optionally, the recording
-- the sender wants delivered. The transcript is parsed first, then the sender
-- chooses which form to deliver — so the parsed request has to survive between
-- their voice note and their answer.

CREATE TABLE IF NOT EXISTS pending_voice (
  pending_id        SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  sender_phone      VARCHAR(20) NOT NULL,
  media_id          VARCHAR(128) NOT NULL,
  transcript        TEXT NOT NULL,
  entities          JSONB,
  confirmation_text TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_voice_sender
  ON pending_voice(sender_phone, created_at DESC);

-- When set, this queue row delivers the original recording rather than text.
ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS media_id VARCHAR(128);
