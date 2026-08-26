import axios from 'axios';

const MAX_BYTES = 16 * 1024 * 1024; // Meta's own ceiling for voice notes

/**
 * Download a media file that arrived on a webhook.
 *
 * Meta does not put the file on the webhook — it sends an id that must first
 * be exchanged for a short-lived URL, and that URL then needs the same bearer
 * token to fetch. Both steps fail silently in different ways, so each is
 * checked separately.
 */
export async function downloadMedia(mediaId) {
  const apiToken = process.env.META_API_TOKEN;
  if (!apiToken) throw new Error('META_API_TOKEN not configured');

  const meta = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
    timeout: 10000
  });

  const { url, mime_type: mimeType, file_size: fileSize } = meta.data;
  if (!url) throw new Error('Meta returned no download URL for this media');

  if (fileSize && Number(fileSize) > MAX_BYTES) {
    throw new Error(`Media too large: ${fileSize} bytes`);
  }

  const file = await axios.get(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
    responseType: 'arraybuffer',
    maxContentLength: MAX_BYTES,
    timeout: 30000
  });

  return {
    buffer: Buffer.from(file.data),
    mimeType: mimeType || 'audio/ogg',
    size: file.data.byteLength
  };
}
