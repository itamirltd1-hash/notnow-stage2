import crypto from 'crypto';

/**
 * Validate Meta webhook signature.
 * Meta sends X-Hub-Signature-256 header with each webhook call.
 * Uses META_APP_SECRET (from Meta App Settings), not META_VERIFY_TOKEN.
 * META_VERIFY_TOKEN is only for GET verification challenge.
 */
export function validateMetaWebhookSignature(req) {
  const appSecret = process.env.META_APP_SECRET;
  const signature = req.headers['x-hub-signature-256'];

  if (!appSecret || !signature) {
    console.warn('⚠️ Webhook validation failed: missing secret or signature header');
    return false;
  }

  // Meta sends the request body as raw text for signing
  // Extract the raw body (before JSON parsing)
  const body = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body);

  const hash = crypto
    .createHmac('sha256', appSecret)
    .update(body)
    .digest('hex');

  const expected = `sha256=${hash}`;

  if (signature !== expected) {
    console.error('❌ Invalid webhook signature - possible tampering attempt');
    return false;
  }

  return true;
}

/**
 * Extract message data from Meta webhook payload.
 * Returns { phone, text, messageId } or null if not a message event.
 */
export function extractMessageFromWebhook(body) {
  try {
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;

    if (!messages || messages.length === 0) {
      return null;
    }

    const message = messages[0];

    // Only process text messages for now (Cycle 3)
    if (message.type !== 'text') {
      return null;
    }

    return {
      phone: message.from,
      text: message.text?.body,
      messageId: message.id,
      timestamp: message.timestamp
    };
  } catch (error) {
    console.error('Error extracting message from webhook:', error.message);
    return null;
  }
}

/**
 * Format response to send back to user via Meta API.
 * Used to confirm actions ("Got it! Scheduled message to...").
 */
export function formatMetaResponse(recipientPhone, text) {
  return {
    messaging_product: 'whatsapp',
    to: recipientPhone,
    type: 'text',
    text: {
      body: text
    }
  };
}
