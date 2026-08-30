-- ============================================================================
-- Files that could not travel with their message
-- ============================================================================
-- No approved template carries a file, so a photo scheduled to someone
-- outside the 24-hour window goes out as text only. The text tells them to
-- reply so the file can follow — and nothing was making that true.
--
-- Marking the row lets the file be delivered the moment their reply opens
-- the window, which is what they were told would happen.

ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS media_deferred BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_active_queue_media_deferred
  ON active_queue(recipient_phone) WHERE media_deferred;
