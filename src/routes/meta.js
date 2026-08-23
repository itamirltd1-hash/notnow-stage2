import express from 'express';
import { validateMetaWebhookSignature, extractMessageFromWebhook, formatMetaResponse } from '../meta/webhookHandler.js';
import { sendWhatsAppMessage } from '../meta/sendHandler.js';
import { parseSchedulingIntent, detectLanguage } from '../llm/intentParser.js';
import { extractWhatsappUserContext } from '../middleware/whatsappUserContext.js';
import { registerOrUpdateContact, getContactNameByPhone } from '../auth/userContextExtractor.js';
import { userQuery } from '../db/multitenancyHelpers.js';

const router = express.Router();

/**
 * GET /api/meta/webhook
 * Webhook verification endpoint for Meta.
 */
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.META_VERIFY_TOKEN;

  if (!verifyToken) {
    return res.status(500).json({ success: false, error: 'META_VERIFY_TOKEN not configured' });
  }

  if (mode === 'subscribe' && token === verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.status(403).json({ success: false, error: 'Verification failed' });
  }
});

/**
 * POST /api/meta/webhook
 * Receive incoming WhatsApp messages from Meta.
 * Parse intent, queue message, send confirmation.
 */
router.post('/webhook', async (req, res) => {
  try {
    // Validate signature
    if (!validateMetaWebhookSignature(req)) {
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }

    // Acknowledge receipt (Meta requires quick 200 response)
    res.status(200).json({ success: true });

    // Extract message from webhook
    const messageData = extractMessageFromWebhook(req.body);
    if (!messageData) {
      return; // Not a text message, skip
    }

    const { phone, text, messageId } = messageData;

    // Validate message length (prevent abuse)
    if (!text || text.length > 4096) {
      console.warn(`Message rejected: invalid length (${text?.length || 0} chars)`);
      return;
    }

    // Sanitize phone number (should be digits and +)
    if (!/^[\d\+\-\s()]+$/.test(phone)) {
      console.warn(`Invalid phone format: ${phone}`);
      return;
    }

    // Extract user context (via phone → contacts lookup)
    await extractWhatsappUserContext(req, res, () => {});

    if (!req.userId) {
      // Unknown sender — for now, just log (can implement registration flow later)
      console.log(`Unknown sender ${phone}: "${text}"`);
      return;
    }

    // Detect language
    const language = detectLanguage(text);

    // Parse intent using Claude Haiku
    console.log(`🧠 Parsing intent for: "${text}"`);
    const intentResult = await parseSchedulingIntent(text, language);
    console.log(`   Result:`, intentResult);

    if (!intentResult.success || !intentResult.intent) {
      // Failed to parse — send error message back
      const errorMsg = intentResult.error || 'Could not understand your message. Try: "Schedule message to [name] at [time]"';
      console.log(`⚠️  Intent parse failed, sending error:`, errorMsg);
      await sendWhatsAppMessage(phone, errorMsg);
      return;
    }
    console.log(`✅ Intent: ${intentResult.intent}`);

    const { intent, entities, confirmationText } = intentResult;

    // Handle different intents
    switch (intent) {
      case 'SCHEDULE_MESSAGE':
        await handleScheduleMessage(req.userId, phone, entities, confirmationText);
        break;

      case 'CANCEL_SCHEDULED':
        // TODO: Cycle 3+ feature
        await sendWhatsAppMessage(phone, 'Cancel feature coming soon!');
        break;

      case 'LIST_QUEUE':
        // TODO: Cycle 3+ feature
        await sendWhatsAppMessage(phone, 'Queue listing feature coming soon!');
        break;

      case 'UPGRADE_TIER':
        // TODO: Cycle 4 feature
        await sendWhatsAppMessage(phone, 'Upgrade feature coming soon! Stay tuned.');
        break;

      default:
        await sendWhatsAppMessage(phone, 'Intent not recognized. Please try again.');
    }
  } catch (error) {
    console.error('Error processing webhook:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Handle SCHEDULE_MESSAGE intent.
 * Queue the message and send confirmation.
 */
async function handleScheduleMessage(userId, senderPhone, entities, confirmationText) {
  try {
    const { recipient_phone, recipient_name, message_body, scheduled_timestamp, delivery_channel } = entities;

    if (!recipient_phone || !message_body || !scheduled_timestamp) {
      await sendWhatsAppMessage(senderPhone, 'Missing details. Please include: recipient, message, and time.');
      return;
    }

    // Register/update contact if needed
    await registerOrUpdateContact(userId, recipient_phone, recipient_name);

    // Insert into queue
    const result = await userQuery(
      userId,
      `INSERT INTO active_queue
       (user_id, recipient_phone, recipient_name, message_body, channel, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING queue_id`,
      [recipient_phone, recipient_name, message_body, delivery_channel || 'whatsapp', scheduled_timestamp]
    );

    // Send confirmation to user
    await sendWhatsAppMessage(senderPhone, confirmationText);

    console.log(`✅ Message queued: user=${userId}, queue_id=${result.rows[0].queue_id}`);
  } catch (error) {
    console.error('Error scheduling message:', error.message);
    await sendWhatsAppMessage(senderPhone, 'Failed to schedule message. Please try again.');
  }
}

export default router;
