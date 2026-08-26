-- ============================================================================
-- Delivery status tracking
-- ============================================================================
-- Meta answers a send with 200 OK and reports the real outcome later, in a
-- separate `statuses` webhook. Without the provider's message id on the row
-- there is no way to correlate that callback back to the queued message, so
-- active_queue.status could claim 'sent' for a message that never arrived.

ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(128);
ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS error_code INTEGER;
ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_active_queue_provider_msg
  ON active_queue(provider_message_id);
