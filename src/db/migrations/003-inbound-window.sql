-- ============================================================================
-- Inbound message tracking (WhatsApp 24-hour service window)
-- ============================================================================
-- WhatsApp only allows free-form text to someone who messaged the business in
-- the last 24 hours; outside that window a send fails with error 131047 and an
-- approved template must be used instead. Knowing when each number last wrote
-- to us is the only way to choose correctly before sending.
--
-- The window belongs to the business phone number, not to a tenant, so this
-- table is deliberately global rather than scoped by user_id.

CREATE TABLE IF NOT EXISTS whatsapp_inbound (
  phone_number    VARCHAR(20) PRIMARY KEY,
  last_message_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
