-- ============================================================================
-- Which of our numbers a recipient wrote to
-- ============================================================================
-- Migration 003 said it out loud — "the window belongs to the business phone
-- number, not to a tenant" — and then keyed the table by the recipient alone.
--
-- That holds for exactly as long as there is one sending number. On the day it
-- changes, every recipient who wrote in the previous 24 hours still looks open
-- to us while Meta has no conversation with them at all: the free-form send is
-- rejected with 131047 instead of falling back to a template, and a day's
-- messages fail for no visible reason.
--
-- Rows written before this column existed cannot say which number they belong
-- to. They are marked 'unknown', which matches no real phone number ID, so
-- they read as closed — a template send always works, and the window reopens
-- by itself the next time the recipient writes.

ALTER TABLE whatsapp_inbound ADD COLUMN IF NOT EXISTS business_phone_id VARCHAR(32);

UPDATE whatsapp_inbound SET business_phone_id = 'unknown' WHERE business_phone_id IS NULL;

ALTER TABLE whatsapp_inbound ALTER COLUMN business_phone_id SET NOT NULL;

-- A unique index rather than a primary key: this file runs on every boot, and
-- dropping and re-adding a constraint each time is churn that can fail midway.
ALTER TABLE whatsapp_inbound DROP CONSTRAINT IF EXISTS whatsapp_inbound_pkey;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_inbound_number_business
  ON whatsapp_inbound (phone_number, business_phone_id);
