-- ============================================================================
-- The language a user is answered in
-- ============================================================================
-- Detecting it per message means someone who types "ok" gets an English reply
-- and their next Hebrew sentence gets a Hebrew one. The language is decided
-- once, from the first message, and changed only when the user asks.

ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'he';
