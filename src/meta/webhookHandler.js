import crypto from 'crypto';

/**
 * Validate Meta webhook signature.
 * Meta sends X-Hub-Signature header with each webhook call.
 */
export function validateMetaWebhookSignature(req) {
  const token = process.env.META_VERIFY_TOKEN || 'your_verify_token';
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    return false;
  }

  const hash = crypto
    .createHmac('sha256', token)
    .update(JSON.stringify(req.body))
    .digest('hex');

  const expected = `sha256=${hash}`;
  return signature === expected;
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
