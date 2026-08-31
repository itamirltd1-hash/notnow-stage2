-- ============================================================================
-- A request still being assembled
-- ============================================================================
-- The bot would ask "מה לשלוח?" and then parse the answer as a brand new
-- request, with no recipient — so it asked again. The question was fine; the
-- answer had nowhere to land.
--
-- Only the parsed fields are kept, not the conversation: a recipient, a time,
-- a message. It expires in minutes, and everything already stored elsewhere
-- (the queue, contacts, groups) remains the place to look things up.

CREATE TABLE IF NOT EXISTS pending_request (
  request_id   SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  sender_phone VARCHAR(20) NOT NULL,
  entities     JSONB NOT NULL,
  media_id     VARCHAR(128),
  media_type   VARCHAR(20),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_request_sender
  ON pending_request(sender_phone, created_at DESC);
