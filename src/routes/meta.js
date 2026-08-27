import express from 'express';
import { validateMetaWebhookSignature, extractMessageFromWebhook, extractStatusesFromWebhook, formatMetaResponse } from '../meta/webhookHandler.js';
import { recordDeliveryStatuses } from '../meta/deliveryStatus.js';
import { sendWhatsAppMessage } from '../meta/sendHandler.js';
import { parseSchedulingIntent, detectLanguage } from '../llm/intentParser.js';
import { extractWhatsappUserContext } from '../middleware/whatsappUserContext.js';
import { registerOrUpdateContact, getContactNameByPhone, autoRegisterSender, normalizePhoneNumber, findContactsByName } from '../auth/userContextExtractor.js';
import { recordInboundMessage } from '../meta/serviceWindow.js';
import { getConsentStatus, requestConsent, handleConsentReply } from '../meta/consent.js';
import { findGroupsByName, getGroupMembers, listGroups, removeGroupMember } from '../groups/groupService.js';
import { storeChoice, resolveChoice, formatOptions } from '../meta/pendingChoice.js';
import {
  parseGroupCommand, runGroupCommand, looksLikeGroupCommand,
  isPendingRecipient, SYNTAX_HELP
} from '../groups/groupCommands.js';
import { isGreeting, isHelpRequest, welcomeMessage, helpMessage, consentClarification } from '../meta/welcome.js';
import { parseQueueCommand, runQueueCommand } from '../queue/queueCommands.js';
import { checkUserQuota, incrementMonthlyUsage } from '../billing/quotaMiddleware.js';
import { downloadMedia } from '../meta/mediaDownload.js';
import { transcribeAudio, isTranscriptionAvailable } from '../llm/transcriber.js';
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

    const { phone, type, mediaId } = messageData;
    let { text } = messageData;

    // Sanitize phone number (should be digits and +)
    if (!/^[\d\+\-\s()]+$/.test(phone)) {
      console.warn(`Invalid phone format: ${phone}`);
      return;
    }

    if (type === 'text' && (!text || text.length > 4096)) {
      console.warn(`Message rejected: invalid length (${text?.length || 0} chars)`);
      return;
    }

    // This inbound message opens a 24-hour window for free-form replies
    await recordInboundMessage(phone);

    // A question the bot asked a moment ago outranks any older state: the
    // letter was offered for that question, so resolve it first. The stored
    // row carries its own user_id, which is why this can run before identity.
    if (type === 'text') {
      const choice = await resolveChoice(phone, text);
      if (choice) {
        await handleChoice(choice.userId, phone, choice);
        return;
      }
    }

    // A recipient answering "כן" or "הסר" is not issuing a command — resolve
    // consent before anything can mistake them for a tenant and register them.
    if (type === 'text' && await handleConsentReply(phone, text)) {
      return;
    }

    // Extract user context (via phone → contacts lookup)
    await extractWhatsappUserContext(req, res, () => {});

    // Someone who was asked for permission and answered with something other
    // than yes/no is still in that conversation. Re-ask; don't onboard them.
    if (!req.userId && type === 'text' && await isPendingRecipient(phone)) {
      await sendWhatsAppMessage(phone, consentClarification());
      return;
    }

    let isNewUser = false;
    if (!req.userId) {
      console.log(`🆕 Auto-registering new sender ${phone}`);
      const newUser = await autoRegisterSender(phone);
      if (!newUser) {
        await sendWhatsAppMessage(phone, 'לא הצלחתי לרשום את המספר שלך. אפשר לנסות שוב בעוד רגע.');
        return;
      }
      req.userId = newUser.user_id;
      isNewUser = true;
      console.log(`✅ Registered user ${newUser.user_id} for ${phone}`);
    }

    // A first message, a greeting or a request for help are all answered from
    // static text — no model call, no "לא הבנתי" as an opening impression.
    if (type === 'text' && (isNewUser || isGreeting(text))) {
      await sendWhatsAppMessage(phone, isNewUser ? welcomeMessage() : helpMessage());
      return;
    }
    if (type === 'text' && isHelpRequest(text)) {
      await sendWhatsAppMessage(phone, helpMessage());
      return;
    }

    // Seeing and cancelling the queue: also patterns, for the same reason as
    // group management — cancelling the wrong message is not recoverable.
    if (type === 'text') {
      const queueCommand = parseQueueCommand(text);
      if (queueCommand) {
        await sendWhatsAppMessage(phone, await runQueueCommand(req.userId, queueCommand));
        return;
      }
    }

    // Group management is matched by pattern, not parsed by the model.
    if (type === 'text') {
      const command = parseGroupCommand(text);
      if (command) {
        const result = await runGroupCommand(req.userId, command);
        if (result) {
          // An ambiguous removal comes back as options rather than text.
          if (typeof result === 'object') {
            await storeChoice(req.userId, phone, result.choice.kind, result.choice.payload);
            await sendWhatsAppMessage(phone, result.reply);
          } else {
            await sendWhatsAppMessage(phone, result);
          }
          return;
        }
        // 'members' returns null when the phrase was not about a group at all,
        // so it falls through to the scheduler rather than dead-ending.
      } else if (looksLikeGroupCommand(text)) {
        // Opens with a management verb but matches no command — a wording slip.
        // Showing the syntax beats sending it to the scheduler to fail there.
        await sendWhatsAppMessage(phone, `לא זיהיתי את הפקודה.\n\n${SYNTAX_HELP}`);
        return;
      }
    }

    // A voice note has to become text before anything can be parsed from it.
    if (type === 'audio') {
      text = await handleVoiceNote(req.userId, phone, mediaId);
      if (!text) return; // the sender already got an explanation
    }

    // The voice delivery question is answered by a letter now, through the
    // same pending_choice path as every other question, above.

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
        || 'לא הבנתי. אפשר למשל: שלח לדני 0501234567 מחר ב-9:00 "נתראה בפגישה"';
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

      // Phrased loosely enough that the patterns missed it — show the queue
      // and let the sender pick a number rather than guessing which to cancel.
      case 'CANCEL_SCHEDULED':
        await sendWhatsAppMessage(phone, await runQueueCommand(req.userId, { action: 'cancel', target: null }));
        break;

      case 'LIST_QUEUE':
        await sendWhatsAppMessage(phone, await runQueueCommand(req.userId, { action: 'list' }));
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
 * Act on a one-letter answer to whatever the bot last asked.
 * The original request was parked whole, so answering resumes it exactly
 * where it stopped rather than starting over.
 */
async function handleChoice(userId, senderPhone, choice) {
  if (choice.kind === 'out_of_range') {
    await sendWhatsAppMessage(
      senderPhone,
      `יש ${choice.optionCount} אפשרויות. להשיב באות שמופיעה ברשימה.`
    );
    return;
  }

  const { payload, option } = choice;

  switch (choice.kind) {
    case 'schedule_recipient': {
      const entities = { ...payload.entities, recipient_phone: option.phone, recipient_name: option.name, recipient_group: null };
      await handleScheduleMessage(userId, senderPhone, entities, payload.confirmationText, payload.mediaId);
      return;
    }

    case 'schedule_group': {
      const entities = { ...payload.entities, recipient_group: option.name, recipient_name: null, recipient_phone: null };
      await handleScheduleMessage(userId, senderPhone, entities, payload.confirmationText, payload.mediaId);
      return;
    }

    case 'remove_member': {
      const removed = await removeGroupMember(userId, payload.groupId, option.contact_id);
      await sendWhatsAppMessage(
        senderPhone,
        removed
          ? `${option.name} (${option.phone}) הוסר מ"${payload.groupName}".`
          : `לא הצלחתי להסיר את ${option.name}.`
      );
      return;
    }

    case 'voice_delivery': {
      const mediaId = option.mode === 'audio' ? payload.mediaId : null;
      console.log(`🎙️  Sender chose to deliver the ${option.mode}`);
      await handleScheduleMessage(userId, senderPhone, payload.entities, payload.confirmationText, mediaId);
      return;
    }

    default:
      await sendWhatsAppMessage(senderPhone, 'לא הצלחתי להשלים את הבחירה. אפשר לשלוח את הבקשה שוב.');
  }
}

/**
 * Turn an incoming voice note into an actionable request.
 *
 * The recording usually carries the whole command, so it is transcribed and
 * parsed straight away — then the sender is asked which form to deliver: the
 * words as text, or the recording itself. Returns the transcript only when it
 * is not a scheduling request and should continue through normal handling;
 * otherwise it has already replied and returns null.
 */
async function handleVoiceNote(userId, phone, mediaId) {
  if (!mediaId) {
    await sendWhatsAppMessage(phone, 'לא הצלחתי לקרוא את ההקלטה. אפשר לשלוח שוב.');
    return null;
  }

  if (!isTranscriptionAvailable()) {
    await sendWhatsAppMessage(phone, 'תמלול הודעות קוליות עדיין לא זמין. שלח את הבקשה כטקסט.');
    return null;
  }

  let transcript;
  try {
    const audio = await downloadMedia(mediaId);
    transcript = await transcribeAudio(audio.buffer, audio.mimeType, 'he');
  } catch (error) {
    console.error('Voice note failed:', error.message);
    await sendWhatsAppMessage(phone, 'לא הצלחתי לתמלל את ההקלטה. אפשר לנסות שוב, או לכתוב את הבקשה.');
    return null;
  }

  if (!transcript) {
    await sendWhatsAppMessage(phone, 'ההקלטה יצאה ריקה. אפשר להקליט שוב.');
    return null;
  }

  const intentResult = await parseSchedulingIntent(transcript, 'he');

  // Not a scheduling request — let the normal path answer it.
  if (!intentResult.success || intentResult.intent !== 'SCHEDULE_MESSAGE'
      || (intentResult.confidence ?? 0) < 0.5) {
    return transcript;
  }

  await storeChoice(userId, phone, 'voice_delivery', {
    options: [
      { mode: 'text', label: 'טקסט' },
      { mode: 'audio', label: 'הקלטה' }
    ],
    entities: intentResult.entities,
    confirmationText: intentResult.confirmationText,
    mediaId,
    transcript
  });

  await sendWhatsAppMessage(
    phone,
    `תמללתי: "${transcript}"\n\n` +
    `מה לשלוח לנמען?\n` +
    `א. את המילים כהודעת טקסט\n` +
    `ב. את ההקלטה המקורית\n\n` +
    `להשיב באות. לתשומת לבכם: הקלטה מגיעה רק למי שכתב לבוט ב-24 השעות האחרונות — ` +
    `אחרת תישלח גרסת הטקסט.`
  );

  return null;
}

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
      return {
        reply: `יש לי כמה קבוצות בשם הזה. לאיזו?\n\n` +
          formatOptions(candidates, g => g.name) +
          `\n\nלהשיב באות.`,
        choice: {
          kind: 'schedule_group',
          options: candidates.map(g => ({ name: g.name, group_id: g.group_id }))
        }
      };
    }
    if (!match) {
      return { reply: `אין לי קבוצה בשם "${groupName}". שלח "קבוצות" כדי לראות מה שמור אצלי.` };
    }

    const members = await getGroupMembers(userId, match.group_id);
    if (members.length === 0) {
      return { reply: `הקבוצה "${match.name}" ריקה. צריך להוסיף אליה אנשי קשר קודם.` };
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
      return {
        reply: `יש לי כמה אנשי קשר בשם הזה. למי מהם?\n\n` +
          formatOptions(candidates, c => `${c.name} — ${c.phone_number}`) +
          `\n\nלהשיב באות.`,
        choice: {
          kind: 'schedule_recipient',
          options: candidates.map(c => ({ name: c.name, phone: c.phone_number }))
        }
      };
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
async function handleScheduleMessage(userId, senderPhone, entities, confirmationText, mediaId = null) {
  try {
    const { message_body, scheduled_timestamp, delivery_channel } = entities;
    console.log('   Entities:', JSON.stringify(entities));

    const resolved = await resolveRecipients(userId, entities);
    if (resolved.reply) {
      // An ambiguous request stays answerable: park the options so a single
      // letter can finish it, instead of making the sender retype everything.
      if (resolved.choice) {
        await storeChoice(userId, senderPhone, resolved.choice.kind, {
          options: resolved.choice.options,
          entities,
          confirmationText,
          mediaId
        });
      }
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
        ? `\n\nאין לי מספר שמור עבור ${resolved.missingRecipientName}. אפשר לשלוח פעם אחת עם המספר, ואשמור אותו.`
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
      await sendWhatsAppMessage(senderPhone, 'לא הצלחתי להבין את המועד. אפשר למשל "מחר ב-9:00" או "עוד שעתיים".');
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
         (user_id, recipient_phone, recipient_name, message_body, channel, scheduled_at, status, group_id, media_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING queue_id`,
        [
          recipient.phone, recipient.name, message_body,
          delivery_channel || 'whatsapp', scheduled_timestamp, status,
          group?.group_id || null, mediaId
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
    await sendWhatsAppMessage(senderPhone, 'לא הצלחתי לתזמן את ההודעה. אפשר לנסות שוב.');
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
