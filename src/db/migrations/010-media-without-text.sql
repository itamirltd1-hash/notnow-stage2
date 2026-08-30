-- ============================================================================
-- A photo can be the whole message
-- ============================================================================
-- message_body was NOT NULL from the days when every message was text. A
-- photo captioned only with the scheduling instruction has no text to
-- deliver, and the file itself is the content.
--
-- The constraint is replaced rather than dropped: a queued row must still
-- carry something to send.

ALTER TABLE active_queue ALTER COLUMN message_body DROP NOT NULL;

ALTER TABLE active_queue DROP CONSTRAINT IF EXISTS active_queue_has_content;
ALTER TABLE active_queue ADD CONSTRAINT active_queue_has_content
  CHECK (message_body IS NOT NULL OR media_id IS NOT NULL);
