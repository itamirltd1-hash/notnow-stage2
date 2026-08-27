-- ============================================================================
-- Open questions awaiting a one-letter answer
-- ============================================================================
-- The bot used to list "מירית 0507467974 / מירית 0521234567" and ask which —
-- with no way to answer. The sender had to retype the whole command. A reply
-- of "ב" means nothing on its own, so the question has to outlive it.
--
-- Letters, not digits: digits already address the queue ("בטל 2"), and a bare
-- number would be ambiguous between the two.

CREATE TABLE IF NOT EXISTS pending_choice (
  choice_id    SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  sender_phone VARCHAR(20) NOT NULL,
  kind         VARCHAR(40) NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_choice_sender
  ON pending_choice(sender_phone, created_at DESC);
