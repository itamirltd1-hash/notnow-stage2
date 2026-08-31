-- ============================================================================
-- What a bare hour means to this person
-- ============================================================================
-- "מחר ב-8" is eight in the morning to one person and eight in the evening to
-- another, and getting it wrong sends the message twelve hours off. The
-- question is asked once per hour per user, and the answer remembered.

CREATE TABLE IF NOT EXISTS hour_preference (
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  stated_hour   SMALLINT NOT NULL,
  resolved_hour SMALLINT NOT NULL,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, stated_hour)
);
