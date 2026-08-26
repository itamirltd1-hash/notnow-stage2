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

  // TODO: Remove this after getting META_APP_SECRET from Meta
  if (!appSecret || appSecret.startsWith('your_')) {
    console.warn('⚠️ Webhook signature validation SKIPPED - no APP_SECRET yet');
    return true; // Allow webhook without validation (temporary!)
  }

  if (!signature) {
    console.warn('⚠️ Webhook validation failed: missing signature header');
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
 * Extract delivery-status events from a Meta webhook payload.
 * Meta reports the real outcome of a send here, not in the send response.
 * Returns [{ messageId, status, timestamp, errorCode, errorMessage }].
 */
export function extractStatusesFromWebhook(body) {
  try {
    const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
    if (!Array.isArray(statuses) || statuses.length === 0) {
      return [];
    }

    return statuses.map(s => {
      const err = s.errors?.[0];
      return {
        messageId: s.id,
        status: s.status,
        timestamp: s.timestamp,
        recipient: s.recipient_id,
        errorCode: err?.code ?? null,
        errorMessage: err?.error_data?.details || err?.title || null
      };
    });
  } catch (error) {
    console.error('Error extracting statuses from webhook:', error.message);
    return [];
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
