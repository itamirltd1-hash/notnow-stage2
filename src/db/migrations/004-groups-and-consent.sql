-- ============================================================================
-- Virtual groups + recipient consent
-- ============================================================================
-- A "group" here is a saved list, not a WhatsApp group chat. Scheduling to one
-- fans out into an individual 1-on-1 message per member, so every recipient
-- keeps their own delivery status, retries and consent state.

CREATE TABLE IF NOT EXISTS groups (
  group_id   SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT groups_user_name_unique UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_member_id SERIAL PRIMARY KEY,
  group_id        INTEGER NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  contact_id      INTEGER NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT group_members_unique UNIQUE (group_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_groups_user ON groups(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);

-- Consent. Meta requires opt-in before a business may message someone, and a
-- recipient who never agreed is the one most likely to report the number —
-- which is what degrades quality rating and gets a sender restricted.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_status VARCHAR(20)
  NOT NULL DEFAULT 'unknown';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_requested_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_updated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_consent_status_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_consent_status_check
  CHECK (consent_status IN ('unknown', 'requested', 'granted', 'declined'));

CREATE INDEX IF NOT EXISTS idx_contacts_phone_consent
  ON contacts(phone_number, consent_status);

-- Queue rows now remember which group produced them, and can sit in states
-- that did not exist before: waiting for consent, or cancelled because it
-- was refused.
ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS group_id INTEGER
  REFERENCES groups(group_id) ON DELETE SET NULL;

ALTER TABLE active_queue DROP CONSTRAINT IF EXISTS active_queue_status_check;
ALTER TABLE active_queue ADD CONSTRAINT active_queue_status_check
  CHECK (status IN ('pending', 'awaiting_consent', 'sent', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_active_queue_group ON active_queue(group_id);
