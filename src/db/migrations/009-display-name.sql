-- ============================================================================
-- What to call a user in front of other people
-- ============================================================================
-- The consent request is the first thing a stranger sees, and "משתמש NotNow
-- מבקש..." tells them nothing. WhatsApp already sends the sender's profile
-- name on every inbound message, so this can be filled without asking.
--
-- Kept separate from the profile name itself: profile names are often
-- nicknames, emoji or company names that read badly to a recipient, so the
-- user must be able to override what is shown on their behalf.

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);

-- True once the user has chosen a name themselves, so a later profile change
-- does not quietly overwrite their choice.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_is_custom BOOLEAN NOT NULL DEFAULT FALSE;
