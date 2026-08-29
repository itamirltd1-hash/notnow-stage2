-- ============================================================================
-- Media waiting to be scheduled
-- ============================================================================
-- People send a photo and then say what to do with it in the next message.
-- That photo is context, not a question, so it cannot live in pending_choice:
-- storing a choice clears any other open question by design, which would wipe
-- the photo the moment the bot asked anything else.

CREATE TABLE IF NOT EXISTS pending_media (
  pending_id   SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  sender_phone VARCHAR(20) NOT NULL,
  media_id     VARCHAR(128) NOT NULL,
  media_type   VARCHAR(20) NOT NULL,
  caption      TEXT,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_media_sender
  ON pending_media(sender_phone, created_at DESC);

-- Which kind of file a queued row carries, so the dispatcher knows whether to
-- send it as an image, a video or a voice note.
ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS media_type VARCHAR(20);
