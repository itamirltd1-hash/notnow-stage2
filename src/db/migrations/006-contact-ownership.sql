-- ============================================================================
-- Tell a tenant apart from a recipient
-- ============================================================================
-- Identification used to be "whoever has this number in their contacts", which
-- meant any recipient of a tenant's messages was authenticated AS that tenant:
-- they could schedule from that tenant's quota, to that tenant's contacts.
-- Exactly one contact per user is the user themselves, and only that row may
-- identify an inbound sender.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: auto-registered tenants carry their phone in their generated
-- email, which is the only reliable link back to their own contact row.
UPDATE contacts c
   SET is_owner = TRUE
  FROM users u
 WHERE c.user_id = u.user_id
   AND u.email = REPLACE(c.phone_number, '+', '') || '@whatsapp.notnow.local'
   AND c.is_owner = FALSE;

-- A user has at most one self-contact; more would reopen the same hole.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_single_owner
  ON contacts(user_id) WHERE is_owner;

CREATE INDEX IF NOT EXISTS idx_contacts_owner_phone
  ON contacts(phone_number) WHERE is_owner;
