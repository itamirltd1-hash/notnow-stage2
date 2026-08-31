import express from 'express';
import { validateMetaWebhookSignature, extractMessageFromWebhook, extractStatusesFromWebhook, formatMetaResponse } from '../meta/webhookHandler.js';
import { recordDeliveryStatuses } from '../meta/deliveryStatus.js';
import { sendWhatsAppMessage } from '../meta/sendHandler.js';
import { parseSchedulingIntent, detectLanguage } from '../llm/intentParser.js';
import { extractWhatsappUserContext } from '../middleware/whatsappUserContext.js';
import { registerOrUpdateContact, getContactNameByPhone, autoRegisterSender, normalizePhoneNumber, findContactsByName } from '../auth/userContextExtractor.js';
import { recordInboundMessage } from '../meta/serviceWindow.js';
import { deliverDeferredMedia } from '../meta/deferredMedia.js';
import { isErasureRequest, eraseByPhone, ERASURE_CONFIRMATION } from '../privacy/erasure.js';
import { isTermsAcceptance, hasAcceptedTerms, recordAcceptance, termsPrompt, acceptanceConfirmation } from '../legal/terms.js';
import { getConsentStatus, requestConsent, handleConsentReply } from '../meta/consent.js';
import { findGroupsByName, getGroupMembers, listGroups, removeGroupMember } from '../groups/groupService.js';
import { storeChoice, resolveChoice, formatOptions } from '../meta/pendingChoice.js';
import {
  storePendingMedia, peekPendingMedia, clearPendingMedia,
  isWithinMediaHorizon, MAX_MEDIA_DAYS, MAX_CAPTION
} from '../meta/pendingMedia.js';
import {
  parseGroupCommand, runGroupCommand, looksLikeGroupCommand,
  isPendingRecipient, isKnownRecipient, isGroupsListQuestion, describeGroups,
  SYNTAX_HELP
} from '../groups/groupCommands.js';
import { isGreeting, isHelpRequest, isCourtesy, courtesyReply, welcomeMessage, helpMessage, consentClarification, recipientGreeting } from '../meta/welcome.js';
import { parseNameCommand, runNameCommand, rememberProfileName, getDisplayName } from '../auth/displayName.js';
import { parseQueueCommand, runQueueCommand, cancelChosenEntry } from '../queue/queueCommands.js';
import {
  storePendingRequest, peekPendingRequest, clearPendingRequest,
  mergeEntities, isComplete, isAbandonment, EXPIRED_NOTICE
} from '../scheduling/pendingRequest.js';
import {
  detectAmbiguousHour, recallHour, rememberHour, withHour, formatHour
} from '../scheduling/ambiguousHour.js';
import { checkUserQuota, incrementMonthlyUsage } from '../billing/quotaMiddleware.js';
import { isExempt } from '../billing/exemptions.js';
import { isQuotaQuestion, describeQuota, quotaWarningLine } from '../billing/quotaCommands.js';
import { answerServiceQuestion } from '../meta/faq.js';
import { answerProductQuestion } from '../llm/answerQuestion.js';
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

    const { phone, type, mediaId, profileName } = messageData;
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

    // Which is exactly when a file we promised them can finally be sent.
    await deliverDeferredMedia(phone);

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

    // Asking to be deleted must not first create an account for the person
    // asking, so it is handled before identity like consent is.
    if (type === 'text' && isErasureRequest(text)) {
      await sendWhatsAppMessage(phone, ERASURE_CONFIRMATION);
      await eraseByPhone(phone);
      return;
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

    // Keep the profile name current unless the user has picked their own.
    await rememberProfileName(req.userId, profileName);

    // A first message, a greeting or a request for help are all answered from
    // static text — no model call, no "לא הבנתי" as an opening impression.
    if (type === 'text' && (isNewUser || isGreeting(text))) {
      // Someone who is here because a friend scheduled something for them
      // gets context, not a tour of a product they did not come looking for.
      const asRecipient = await isKnownRecipient(phone);

      await sendWhatsAppMessage(
        phone,
        asRecipient ? recipientGreeting()
          : isNewUser ? welcomeMessage(profileName)
          : helpMessage()
      );
      return;
    }

    if (type === 'text' && isTermsAcceptance(text) && !(await hasAcceptedTerms(req.userId))) {
      await recordAcceptance(req.userId);

      // Carry on with whatever they were trying to schedule when the terms
      // interrupted, rather than making them start over.
      const held = await peekPendingRequest(phone);
      if (held?.is_fresh && isComplete(held.entities, Boolean(held.media_id))) {
        await clearPendingRequest(phone);
        await handleScheduleMessage(
          req.userId, phone, held.entities, null, held.media_id, held.media_type
        );
        return;
      }

      await sendWhatsAppMessage(phone, acceptanceConfirmation());
      return;
    }

    if (type === 'text') {
      const nameCommand = parseNameCommand(text);
      if (nameCommand) {
        await sendWhatsAppMessage(phone, await runNameCommand(req.userId, nameCommand));
        return;
      }
    }
    if (type === 'text' && isHelpRequest(text)) {
      await sendWhatsAppMessage(phone, helpMessage());
      return;
    }

    // A thank-you is not a question about the product.
    if (type === 'text' && isCourtesy(text)) {
      await sendWhatsAppMessage(phone, courtesyReply());
      return;
    }

    // "כמה נשאר לי" and the handful of questions people ask about how this
    // works are answered from static text — no model call for either.
    if (type === 'text') {
      if (isQuotaQuestion(text)) {
        await sendWhatsAppMessage(phone, await describeQuota(req.userId, phone));
        return;
      }

      const faq = answerServiceQuestion(text);
      if (faq) {
        await sendWhatsAppMessage(phone, faq);
        return;
      }
    }

    // Seeing and cancelling the queue: also patterns, for the same reason as
    // group management — cancelling the wrong message is not recoverable.
    if (type === 'text') {
      const queueCommand = parseQueueCommand(text);
      if (queueCommand) {
        const result = await runQueueCommand(req.userId, queueCommand);
        if (typeof result === 'object') {
          await storeChoice(req.userId, phone, result.choice.kind, result.choice.payload);
          await sendWhatsAppMessage(phone, result.reply);
        } else {
          await sendWhatsAppMessage(phone, result);
        }
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

    // A photo or video is held aside. If it arrived with a caption saying what
    // to do, that caption continues as the message; otherwise the sender is
    // told the file is waiting for an instruction.
    if (type === 'image' || type === 'video') {
      await storePendingMedia(req.userId, phone, mediaId, type, text);
      if (!text) {
        await sendWhatsAppMessage(
          phone,
          `קיבלתי את ה${type === 'image' ? 'תמונה' : 'סרטון'}. למי ומתי לשלוח אותו?\n` +
          `למשל: תשלח את זה לדני 0501234567 מחר ב-9:00`
        );
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

    // "אילו קבוצות יש לי", "כמה קבוצות יש לי", or just "קבוצות" — a lookup,
    // not a scheduling request, and answered without a model call.
    if (type === 'text' && isGroupsListQuestion(text)) {
      await sendWhatsAppMessage(phone, await describeGroups(req.userId));
      return;
    }

    // Detect language
    const language = detectLanguage(text);

    // Someone walking away from a half-finished request should be able to say
    // so, rather than having it merge into whatever they say next.
    if (type === 'text' && isAbandonment(text)) {
      await clearPendingRequest(phone);
      await sendWhatsAppMessage(phone, 'בסדר, שכחתי מזה.');
      return;
    }

    // Parse intent using Claude Haiku. Tell it when a file is waiting, so it
    // does not treat the absent message text as something missing.
    const hasMedia = Boolean(mediaId) || Boolean(await peekPendingMedia(phone));
    console.log(`🧠 Parsing intent for: "${text}"${hasMedia ? ' (with media)' : ''}`);
    const intentResult = await parseSchedulingIntent(text, language, { hasMedia });
    console.log(`   Result:`, intentResult);

    // This message may be the answer to a question the bot asked. Fold it into
    // what was already understood, so "נתראה מחר ב-9" after "שלח לדן" is one
    // request and not two incomplete ones.
    const pending = type === 'text' ? await peekPendingRequest(phone) : null;

    if (pending?.is_fresh) {
      intentResult.entities = mergeEntities(pending.entities, intentResult.entities || {});
      intentResult.intent = intentResult.intent || 'SCHEDULE_MESSAGE';
      console.log('   Merged into the open request:', JSON.stringify(intentResult.entities));
    } else if (pending && !isComplete(intentResult.entities || {}, hasMedia)) {
      // The question is gone and this reply cannot stand on its own. Saying so
      // beats asking them to repeat themselves for no visible reason.
      await clearPendingRequest(phone);
      await sendWhatsAppMessage(phone, EXPIRED_NOTICE);
      return;
    }

    // A low-confidence guess is a misunderstanding, not an instruction —
    // ask rather than act on it.
    const MIN_CONFIDENCE = 0.5;

    // Unless the request is already complete. With a file attached, a
    // recipient and a time, nothing is missing — the model's doubt is about
    // the empty message text, which is empty on purpose. Three attempts to
    // settle that in the prompt produced 0.75, 0.65 and 0.45 on the same
    // sentence, so it is settled here instead, against what we can verify.
    // A merged request is judged the same way: by what it holds. The model
    // scored only the last fragment, which on its own looks like nothing.
    const e = intentResult.entities || {};
    const requestIsComplete =
      (hasMedia
        && Boolean(e.recipient_phone || e.recipient_name || e.recipient_group)
        && Boolean(e.scheduled_timestamp))
      || (Boolean(pending?.is_fresh) && isComplete(e, hasMedia));

    // A question changes nothing, so there is no risk in answering an uncertain
    // one — and the answer is grounded in the product description regardless.
    const isQuestion = intentResult.intent === 'PRODUCT_QUESTION';

    const tooUncertain =
      (intentResult.confidence ?? 0) < MIN_CONFIDENCE && !requestIsComplete && !isQuestion;

    if (requestIsComplete && (intentResult.confidence ?? 0) < MIN_CONFIDENCE) {
      console.log('   Acting anyway: file, recipient and time are all present');
    }

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
      case 'SCHEDULE_MESSAGE': {
        // "מחר ב-8" is eight in the morning to some people and eight in the
        // evening to others; guessing wrong sends the message twelve hours off.
        const ambiguous = entities.scheduled_timestamp
          ? detectAmbiguousHour(text)
          : null;

        if (ambiguous) {
          const learned = await recallHour(req.userId, ambiguous.hour);

          if (learned !== null) {
            // Already answered once for this hour. The confirmation states the
            // time, so a wrong guess is visible immediately.
            entities.scheduled_timestamp =
              withHour(entities.scheduled_timestamp, learned, ambiguous.minutes);
            console.log(`   ${ambiguous.hour} → ${learned}:00 from this user's earlier answer`);
          } else {
            await askWhichHour(req.userId, phone, entities, confirmationText, ambiguous);
            break;
          }
        } else if (intentResult.timeIsVague && intentResult.timeOptions?.length === 2) {
          // "על הבוקר" is a range rather than a time.
          await askWhichTime(req.userId, phone, entities, confirmationText, intentResult.timeOptions);
          break;
        }

        await handleScheduleMessage(req.userId, phone, entities, confirmationText);
        break;
      }

      // Phrased loosely enough that the patterns missed it — show the queue
      // and let the sender pick a number rather than guessing which to cancel.
      case 'CANCEL_SCHEDULED':
        await sendWhatsAppMessage(phone, await runQueueCommand(req.userId, { action: 'cancel', target: null }));
        break;

      case 'LIST_QUEUE':
        await sendWhatsAppMessage(phone, await runQueueCommand(req.userId, { action: 'list' }));
        break;

      case 'PRODUCT_QUESTION': {
        // Grounded in what the service actually does, rather than in whatever
        // the scheduling model imagines about it.
        const answer = await answerProductQuestion(text);
        await sendWhatsAppMessage(phone, answer || helpMessage());
        break;
      }

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
 * Ask whether a bare hour meant morning or evening, and remember the answer.
 *
 * Numbered rather than lettered because the two options are clock times, and
 * a numbered list is what people answer with a digit.
 */
async function askWhichHour(userId, senderPhone, entities, confirmationText, ambiguous) {
  const { hour, minutes, morning, evening } = ambiguous;

  await storeChoice(userId, senderPhone, 'schedule_hour', {
    allowDigits: true,
    statedHour: hour,
    minutes,
    options: [{ resolvedHour: morning }, { resolvedHour: evening }],
    entities,
    confirmationText
  });

  await sendWhatsAppMessage(
    senderPhone,
    `${formatHour(hour, minutes)} בבוקר או בערב?\n` +
    `1. ${formatHour(morning, minutes)}\n` +
    `2. ${formatHour(evening, minutes)}`
  );
}

/**
 * Ask which clock time a vague phrase meant, offering the two the model
 * proposed for it. Cheaper than guessing wrong on a message that goes out
 * hours later, when there is nothing left to correct.
 */
async function askWhichTime(userId, senderPhone, entities, confirmationText, options) {
  const label = iso => new Date(iso).toLocaleTimeString('he-IL', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit'
  });

  await storeChoice(userId, senderPhone, 'schedule_time', {
    options: options.map(iso => ({ iso, label: label(iso) })),
    entities,
    confirmationText
  });

  await sendWhatsAppMessage(
    senderPhone,
    `באיזו שעה בדיוק?\n` +
    formatOptions(options.map(iso => ({ iso })), o => label(o.iso)) +
    `\n\nלהשיב באות.`
  );
}

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

    case 'cancel_queue': {
      await sendWhatsAppMessage(senderPhone, await cancelChosenEntry(userId, option.queueIds));
      return;
    }

    case 'schedule_hour': {
      const entities = {
        ...payload.entities,
        scheduled_timestamp: withHour(
          payload.entities.scheduled_timestamp, option.resolvedHour, payload.minutes || 0
        )
      };
      await rememberHour(userId, payload.statedHour, option.resolvedHour);
      await handleScheduleMessage(userId, senderPhone, entities, payload.confirmationText);
      return;
    }

    case 'schedule_time': {
      const entities = { ...payload.entities, scheduled_timestamp: option.iso };
      await handleScheduleMessage(userId, senderPhone, entities, payload.confirmationText);
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
async function handleScheduleMessage(userId, senderPhone, entities, confirmationText, mediaId = null, mediaType = null) {
  try {
    const { message_body, scheduled_timestamp, delivery_channel } = entities;
    console.log('   Entities:', JSON.stringify(entities));

    // "תשלח את זה לדני מחר" refers to the photo sent a moment ago.
    if (!mediaId) {
      const held = await peekPendingMedia(senderPhone);
      if (held) {
        mediaId = held.media_id;
        mediaType = held.media_type;
      }
    }

    // Scheduling is the act that creates obligations towards other people —
    // it waits for agreement. Everything else, including asking for help or
    // to be removed, stays available.
    if (!(await hasAcceptedTerms(userId))) {
      // Hold the request across the interruption. Being asked to agree to
      // terms is no reason to have to type the whole thing again.
      await storePendingRequest(userId, senderPhone, entities, mediaId, mediaType);
      await sendWhatsAppMessage(senderPhone, termsPrompt());
      return;
    }

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
    // An attached photo or recording is the content; text is then optional.
    if (!message_body && !mediaId) missing.push('תוכן ההודעה');
    if (!scheduled_timestamp) missing.push('מועד השליחה');

    if (missing.length > 0) {
      // Hold what is already understood, so the answer completes this request
      // instead of starting a new one that is missing everything else.
      await storePendingRequest(userId, senderPhone, entities, mediaId, mediaType);

      const hint = resolved.missingRecipientName
        ? `\n\nאין לי מספר שמור עבור ${resolved.missingRecipientName}. אפשר לשלוח פעם אחת עם המספר, ואשמור אותו.`
        : '';
      await sendWhatsAppMessage(senderPhone, `חסר לי ${missing.join(' ו')}.${hint}`);
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

    // Meta keeps an uploaded file for about a month, so a photo scheduled
    // beyond that would be queued only to fail on the day. Say so now.
    if (mediaId && !isWithinMediaHorizon(scheduledAt)) {
      await sendWhatsAppMessage(
        senderPhone,
        `קבצים נשמרים אצל וואטסאפ לזמן מוגבל, ולכן אפשר לתזמן אותם עד ${MAX_MEDIA_DAYS} ימים קדימה בלבד.\n\n` +
        `אפשר לתזמן את הקובץ למועד קרוב יותר, או לשלוח עכשיו הודעת טקסט בלבד למועד הרחוק.`
      );
      return;
    }

    if (mediaId && message_body && message_body.length > MAX_CAPTION) {
      await sendWhatsAppMessage(
        senderPhone,
        `הכיתוב לקובץ ארוך מדי — עד ${MAX_CAPTION} תווים. אפשר לקצר אותו?`
      );
      return;
    }

    // Each recipient costs one message, so a group of ten costs ten — except
    // for exempt numbers, which are free in both directions.
    const senderExempt = isExempt(senderPhone);
    const billable = recipients.filter(r => !isExempt(r.phone));

    if (!senderExempt && billable.length > 0) {
      const quota = await checkUserQuota(userId);
      if (!quota.allowed || quota.remaining < billable.length) {
        await sendWhatsAppMessage(
          senderPhone,
          `המכסה החודשית לא מספיקה: נדרשות ${billable.length} הודעות ונשארו ${quota.remaining ?? 0} ` +
          `מתוך ${quota.limit ?? '?'} (${quota.tier ?? 'FREE'}).`
        );
        return;
      }
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
         (user_id, recipient_phone, recipient_name, message_body, channel, scheduled_at, status, group_id, media_id, media_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING queue_id`,
        [
          recipient.phone, recipient.name, message_body,
          delivery_channel || 'whatsapp', scheduled_timestamp, status,
          group?.group_id || null, mediaId, mediaType
        ]
      );

      if (status === 'pending') {
        queued.push(recipient.name || recipient.phone);
      } else {
        awaitingConsent.push(recipient.name || recipient.phone);
        if (consent === 'unknown') {
          // The recipient sees this name and nothing else about the sender,
          // so it has to be one they would recognise.
          const senderName = await getDisplayName(userId);
          await requestConsent(userId, recipient.phone, senderName);
        }
      }

      console.log(`   queue_id=${result.rows[0].queue_id} → ${recipient.phone} (${status})`);
    }

    // Bill only what was actually scheduled, and only what is billable.
    const scheduled = new Set([...queued, ...awaitingConsent]);
    const billed = senderExempt
      ? 0
      : billable.filter(r => scheduled.has(r.name || r.phone)).length;

    if (billed > 0) {
      await incrementMonthlyUsage(userId, billed);
    }

    // The request is complete and must not merge into whatever is said next.
    await clearPendingRequest(senderPhone);

    // The file is now attached to a queued message and should not latch onto
    // the next request as well.
    if (mediaId) await clearPendingMedia(senderPhone);

    // Read the quota after recording usage, so the number quoted is what is
    // actually left. Rides along with the confirmation rather than arriving
    // as a message of its own.
    const warning = billed > 0 ? await quotaWarningLine(userId, senderPhone) : null;

    await sendWhatsAppMessage(
      senderPhone,
      buildScheduleConfirmation({
        group, confirmationText, queued, awaitingConsent, declined,
        mediaType: mediaId ? mediaType : null,
        scheduledAt: scheduled_timestamp,
        recipients
      })
        + (warning || '')
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

const MEDIA_WORD = { image: 'התמונה', video: 'הסרטון', audio: 'ההקלטה' };

/**
 * Name the file and when it goes. Nothing here is a guess, so nothing here
 * needs a model to phrase it.
 */
function mediaConfirmation({ mediaType, scheduledAt, recipients, group }) {
  const when = new Date(scheduledAt).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  const who = group
    ? `לקבוצת ${group.name}`
    : `ל${recipients[0]?.name || recipients[0]?.phone || 'נמען'}`;

  if (!mediaType) return `קיבלתי. ההודעה תישלח ${who} ב-${when}.`;

  const what = MEDIA_WORD[mediaType] || 'הקובץ';
  return `קיבלתי. ${what} תישלח ${who} ב-${when}.`;
}

/**
 * Tell the sender exactly what will happen, including who is still pending —
 * silence about a held message reads as a message that was sent.
 */
function buildScheduleConfirmation({
  group, confirmationText, queued, awaitingConsent, declined,
  mediaType, scheduledAt, recipients
}) {
  // When a file is attached the model keeps apologising for the message text
  // it thinks is missing, twice now despite being told not to. This sentence
  // has to be exact, so it is written here rather than asked for.
  // The model's wording is used when there is one. A request resumed after an
  // interruption has none, so the sentence is written here instead of sent
  // empty.
  const headline = mediaType
    ? mediaConfirmation({ mediaType, scheduledAt, recipients, group })
    : (confirmationText || mediaConfirmation({ mediaType: null, scheduledAt, recipients, group }));

  if (!group && awaitingConsent.length === 0 && declined.length === 0) {
    return headline;
  }

  const lines = [];

  if (group) {
    const total = queued.length + awaitingConsent.length;
    lines.push(`קבוצת "${group.name}": ${total} הודעות אישיות נפרדות תוזמנו.`);
  } else if (queued.length > 0) {
    lines.push(headline);
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
