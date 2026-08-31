-- ============================================================================
-- Documents keep their name
-- ============================================================================
-- WhatsApp shows a document's filename to the recipient. Without carrying it
-- through, a contract someone scheduled arrives called "document.pdf".

ALTER TABLE active_queue ADD COLUMN IF NOT EXISTS media_filename VARCHAR(255);
ALTER TABLE pending_media ADD COLUMN IF NOT EXISTS filename VARCHAR(255);
