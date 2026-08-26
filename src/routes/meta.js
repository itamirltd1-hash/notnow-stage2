import express from 'express';
import { validateMetaWebhookSignature, extractMessageFromWebhook, extractStatusesFromWebhook, formatMetaResponse } from '../meta/webhookHandler.js';
import { recordDeliveryStatuses } from '../meta/deliveryStatus.js';
import { sendWhatsAppMessage } from '../meta/sendHandler.js';
import { parseSchedulingIntent, detectLanguage } from '../llm/intentParser.js';
import { extractWhatsappUserContext } from '../middleware/whatsappUserContext.js';
import { registerOrUpdateContact, getContactNameByPhone, autoRegisterSender, normalizePhoneNumber, findContactsByName } from '../auth/userContextExtractor.js';
import { recordInboundMessage } from '../meta/serviceWindow.js';
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
  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

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
    console.log('📥 Incoming webhook:', JSON.stringify(req.body));

    // Validate signature
    if (!validateMetaWebhookSignature(req)) {
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }

    // Acknowledge receipt (Meta requires quick 200 response)
    res.status(200).json({ success: true });

    // Delivery outcomes arrive here, separately from the send response
    const statuses = extractStatusesFromWebhook(req.body);
    if (statuses.length > 0) {
      await recordDeliveryStatuses(statuses);
      return;
    }

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

    // This inbound message opens a 24-hour window for free-form replies
    await recordInboundMessage(phone);

    // Extract user context (via phone → contacts lookup)
    await extractWhatsappUserContext(req, res, () => {});

    if (!req.userId) {
      console.log(`🆕 Auto-registering new sender ${phone}`);
      const newUser = await autoRegisterSender(phone);
      if (!newUser) {
        await sendWhatsAppMessage(phone, 'Sorry, could not register your number. Please try again later.');
        return;
      }
      req.userId = newUser.user_id;
      console.log(`✅ Registered user ${newUser.user_id} for ${phone}`);
    }

    // Detect language
    const language = detectLanguage(text);

    // Parse intent using Claude Haiku
    console.log(`🧠 Parsing intent for: "${text}"`);
    const intentResult = await parseSchedulingIntent(text, language);
    console.log(`   Result:`, intentResult);

    // A low-confidence guess is a misunderstanding, not an instruction —
    // ask rather than act on it.
    const MIN_CONFIDENCE = 0.5;
    const tooUncertain = (intentResult.confidence ?? 0) < MIN_CONFIDENCE;

    if (!intentResult.success || !intentResult.intent || tooUncertain) {
      // Claude usually phrases the clarification better, and in the user's
      // own language — prefer it over our generic fallback.
      const errorMsg = intentResult.error
        || 'לא הבנתי. נסה למשל: שלח לדני 0501234567 מחר ב-9:00 "נתראה בפגישה"';
      console.log(
        `⚠️  Not acting (success=${intentResult.success}, ` +
        `confidence=${intentResult.confidence}), replying:`, errorMsg
      );
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
    // Response was already sent above; only log here.
    console.error('❌ Error processing webhook:', error.message, error.stack);
  }
});

/**
 * Handle SCHEDULE_MESSAGE intent.
 * Queue the message and send confirmation.
 */
async function handleScheduleMessage(userId, senderPhone, entities, confirmationText) {
  try {
    const { message_body, scheduled_timestamp, delivery_channel } = entities;
    let { recipient_name } = entities;
    // Claude may echo the phone in local form (05...) — store it international.
    let recipient_phone = normalizePhoneNumber(entities.recipient_phone);

    console.log('   Entities:', JSON.stringify(entities));

    // People say "שלח למירית", not a phone number. Resolve the name against
    // the contacts this user already has before asking them to type digits.
    if (!recipient_phone && recipient_name) {
      const { match, candidates } = await findContactsByName(userId, recipient_name);

      if (match) {
        recipient_phone = match.phone_number;
        recipient_name = match.name;
        console.log(`   Resolved "${entities.recipient_name}" → ${recipient_phone}`);
      } else if (candidates.length > 1) {
        const list = candidates.map(c => `• ${c.name} — ${c.phone_number}`).join('\n');
        await sendWhatsAppMessage(
          senderPhone,
          `יש לי כמה אנשי קשר בשם הזה. למי מהם?\n\n${list}`
        );
        return;
      }
    }

    const missing = [];
    if (!recipient_phone) missing.push('מספר הנמען');
    if (!message_body) missing.push('תוכן ההודעה');
    if (!scheduled_timestamp) missing.push('מועד השליחה');

    if (missing.length > 0) {
      const hint = (!recipient_phone && recipient_name)
        ? `\n\nאין לי מספר שמור עבור ${recipient_name}. שלח פעם אחת עם המספר, ואשמור אותו.`
        : '';
      await sendWhatsAppMessage(
        senderPhone,
        `חסר לי ${missing.join(' ו')}.${hint}\n\nדוגמה:\nשלח לדני 0508765480 מחר ב-9:00 "נתראה בפגישה"`
      );
      return;
    }

    // A time that has already passed is almost always a parsing slip or a
    // typo — sending immediately would surprise the user more than asking.
    const scheduledAt = new Date(scheduled_timestamp);
    if (Number.isNaN(scheduledAt.getTime())) {
      await sendWhatsAppMessage(senderPhone, 'לא הצלחתי להבין את המועד. נסה למשל "מחר ב-9:00" או "עוד שעתיים".');
      return;
    }
    if (scheduledAt.getTime() < Date.now() - 60_000) {
      const when = scheduledAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
      await sendWhatsAppMessage(senderPhone, `המועד שביקשת (${when}) כבר עבר. מתי לשלוח?`);
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
