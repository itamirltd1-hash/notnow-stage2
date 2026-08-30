-- ============================================================================
-- Terms acceptance and the right to be erased
-- ============================================================================

-- Which version of the terms a user agreed to, and when. A record that says
-- only "accepted" is worth little once the document changes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20);

-- People who asked to be erased.
--
-- Keeping their number is the one thing that lets the request be honoured:
-- without it, the next person to save them as a contact would start the whole
-- conversation again. Nothing else about them is kept — no name, no messages,
-- no history — and this table is checked before anything is ever sent.
CREATE TABLE IF NOT EXISTS suppressed_phones (
  phone_number VARCHAR(20) PRIMARY KEY,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
