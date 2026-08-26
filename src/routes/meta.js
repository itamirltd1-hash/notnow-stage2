import express from 'express';
import { validateMetaWebhookSignature, extractMessageFromWebhook, extractStatusesFromWebhook, formatMetaResponse } from '../meta/webhookHandler.js';
import { recordDeliveryStatuses } from '../meta/deliveryStatus.js';
import { sendWhatsAppMessage } from '../meta/sendHandler.js';
import { parseSchedulingIntent, detectLanguage } from '../llm/intentParser.js';
import { extractWhatsappUserContext } from '../middleware/whatsappUserContext.js';
import { registerOrUpdateContact, getContactNameByPhone, autoRegisterSender, normalizePhoneNumber, findContactsByName } from '../auth/userContextExtractor.js';
import { recordInboundMessage } from '../meta/serviceWindow.js';
import { getConsentStatus, requestConsent, handleConsentReply } from '../meta/consent.js';
import { findGroupsByName, getGroupMembers, listGroups } from '../groups/groupService.js';
import { checkUserQuota, incrementMonthlyUsage } from '../billing/quotaMiddleware.js';
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

    // A recipient answering "כן" or "הסר" is not issuing a command — resolve
    // consent before anything can mistake them for a tenant and register them.
    if (await handleConsentReply(phone, text)) {
      return;
    }

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

    // A bare "קבוצות" is a lookup, not a scheduling request — answering it
    // directly avoids spending a model call on it.
    if (/^\s*(קבוצות|groups)\s*$/i.test(text)) {
      const groups = await listGroups(req.userId);
      await sendWhatsAppMessage(
        phone,
        groups.length === 0
          ? 'אין לך קבוצות שמורות עדיין.'
          : 'הקבוצות שלך:\n' + groups.map(g => `• ${g.name} (${g.member_count})`).join('\n')
      );
      return;
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
 * Work out who a scheduling request is actually addressed to.
 *
 * Returns { recipients } once resolved, or { reply } with a question when the
 * request is ambiguous or names someone we have no number for.
 */
async function resolveRecipients(userId, entities) {
  const groupName = entities.recipient_group;

  if (groupName) {
    const { match, candidates } = await findGroupsByName(userId, groupName);

    if (candidates.length > 1) {
      const list = candidates.map(g => `• ${g.name}`).join('\n');
      return { reply: `יש לי כמה קבוצות בשם הזה. לאיזו?\n\n${list}` };
    }
    if (!match) {
      return { reply: `אין לי קבוצה בשם "${groupName}". שלח "קבוצות" כדי לראות מה שמור אצלי.` };
    }

    const members = await getGroupMembers(userId, match.group_id);
    if (members.length === 0) {
      return { reply: `הקבוצה "${match.name}" ריקה. הוסף אליה אנשי קשר קודם.` };
    }

    return {
      recipients: members.map(m => ({ phone: m.phone_number, name: m.name })),
      group: match
    };
  }

  let recipientName = entities.recipient_name;
  // Claude may echo the phone in local form (05...) — store it international.
  let recipientPhone = normalizePhoneNumber(entities.recipient_phone);

  // People say "שלח למירית", not a phone number. Resolve the name against
  // the contacts this user already has before asking them to type digits.
  if (!recipientPhone && recipientName) {
    const { match, candidates } = await findContactsByName(userId, recipientName);

    if (match) {
      recipientPhone = match.phone_number;
      recipientName = match.name;
      console.log(`   Resolved "${entities.recipient_name}" → ${recipientPhone}`);
    } else if (candidates.length > 1) {
      const list = candidates.map(c => `• ${c.name} — ${c.phone_number}`).join('\n');
      return { reply: `יש לי כמה אנשי קשר בשם הזה. למי מהם?\n\n${list}` };
    }
  }

  if (!recipientPhone) {
    return { recipients: [], missingRecipientName: recipientName };
  }

  return { recipients: [{ phone: recipientPhone, name: recipientName }] };
}

/**
 * Handle SCHEDULE_MESSAGE intent.
 *
 * A group is a saved list, not a WhatsApp group chat: one command fans out
 * into an individual 1-on-1 message per member, each with its own queue row,
 * consent state and delivery status.
 */
async function handleScheduleMessage(userId, senderPhone, entities, confirmationText) {
  try {
    const { message_body, scheduled_timestamp, delivery_channel } = entities;
    console.log('   Entities:', JSON.stringify(entities));

    const resolved = await resolveRecipients(userId, entities);
    if (resolved.reply) {
      await sendWhatsAppMessage(senderPhone, resolved.reply);
      return;
    }

    const { recipients, group } = resolved;

    const missing = [];
    if (recipients.length === 0) missing.push('מספר הנמען');
    if (!message_body) missing.push('תוכן ההודעה');
    if (!scheduled_timestamp) missing.push('מועד השליחה');

    if (missing.length > 0) {
      const hint = resolved.missingRecipientName
        ? `\n\nאין לי מספר שמור עבור ${resolved.missingRecipientName}. שלח פעם אחת עם המספר, ואשמור אותו.`
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

    // Each recipient costs one message, so a group of ten costs ten.
    const quota = await checkUserQuota(userId);
    if (!quota.allowed || quota.remaining < recipients.length) {
      await sendWhatsAppMessage(
        senderPhone,
        `המכסה החודשית לא מספיקה: נדרשות ${recipients.length} הודעות ונשארו ${quota.remaining ?? 0} ` +
        `מתוך ${quota.limit ?? '?'} (${quota.tier ?? 'FREE'}).`
      );
      return;
    }

    const queued = [];
    const awaitingConsent = [];
    const declined = [];

    for (const recipient of recipients) {
      await registerOrUpdateContact(userId, recipient.phone, recipient.name);
      const consent = await getConsentStatus(userId, recipient.phone);

      if (consent === 'declined') {
        declined.push(recipient.name || recipient.phone);
        continue;
      }

      // Nobody is messaged before they agree. The row waits in the queue and
      // is released — or cancelled — by their answer.
      const status = consent === 'granted' ? 'pending' : 'awaiting_consent';

      const result = await userQuery(
        userId,
        `INSERT INTO active_queue
         (user_id, recipient_phone, recipient_name, message_body, channel, scheduled_at, status, group_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING queue_id`,
        [
          recipient.phone, recipient.name, message_body,
          delivery_channel || 'whatsapp', scheduled_timestamp, status,
          group?.group_id || null
        ]
      );

      if (status === 'pending') {
        queued.push(recipient.name || recipient.phone);
      } else {
        awaitingConsent.push(recipient.name || recipient.phone);
        if (consent === 'unknown') {
          await requestConsent(userId, recipient.phone, 'משתמש NotNow');
        }
      }

      console.log(`   queue_id=${result.rows[0].queue_id} → ${recipient.phone} (${status})`);
    }

    const scheduledCount = queued.length + awaitingConsent.length;
    if (scheduledCount > 0) {
      await incrementMonthlyUsage(userId, scheduledCount);
    }

    await sendWhatsAppMessage(
      senderPhone,
      buildScheduleConfirmation({ group, confirmationText, queued, awaitingConsent, declined })
    );

    console.log(
      `✅ Scheduled: user=${userId}, ready=${queued.length}, ` +
      `awaiting consent=${awaitingConsent.length}, declined=${declined.length}`
    );
  } catch (error) {
    console.error('Error scheduling message:', error.message, error.stack);
    await sendWhatsAppMessage(senderPhone, 'לא הצלחתי לתזמן את ההודעה. נסה שוב.');
  }
}

/**
 * Tell the sender exactly what will happen, including who is still pending —
 * silence about a held message reads as a message that was sent.
 */
function buildScheduleConfirmation({ group, confirmationText, queued, awaitingConsent, declined }) {
  if (!group && awaitingConsent.length === 0 && declined.length === 0) {
    return confirmationText;
  }

  const lines = [];

  if (group) {
    const total = queued.length + awaitingConsent.length;
    lines.push(`קבוצת "${group.name}": ${total} הודעות אישיות נפרדות תוזמנו.`);
  } else if (queued.length > 0) {
    lines.push(confirmationText);
  }

  if (awaitingConsent.length > 0) {
    lines.push(
      `\nממתין לאישור מ־${awaitingConsent.join(', ')} — ` +
      `שלחתי להם בקשת הצטרפות. ההודעה תישלח רק אחרי שיאשרו.`
    );
  }

  if (declined.length > 0) {
    lines.push(`\nלא נשלח ל־${declined.join(', ')} — הם ביקשו לא לקבל הודעות.`);
  }

  return lines.join('\n');
}

export default router;
