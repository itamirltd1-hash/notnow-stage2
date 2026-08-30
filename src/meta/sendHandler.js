import axios from 'axios';

/**
 * Turn a Meta send failure into the thing to actually go and do.
 *
 * Whether a payment method is attached cannot be read from the API, so the
 * only moment it can be reported is when a send is rejected for it. The same
 * is true of most of these: the code is the only signal, and "(#131042)
 * Business eligibility payment issue" does not tell anyone to open billing.
 */
const ERROR_GUIDANCE = {
  131042: 'No payment method on the WhatsApp account. Template messages are billable — ' +
          'add one under WhatsApp Manager → Payment settings.',
  131047: 'Outside the 24-hour window and no template was used. Free-form text only ' +
          'reaches someone who wrote to us in the last 24 hours.',
  132000: 'The template expects a different number of parameters than were sent.',
  132001: 'No such template on the account that owns the sending number. Template and ' +
          'phone number must live on the same WhatsApp account.',
  132005: 'The template exists but is not approved in this language.',
  131026: 'The recipient cannot receive messages — the number may not be on WhatsApp.',
  131031: 'The sending account is restricted or disabled.',
  133010: 'The sending number is not registered for the Cloud API. Run: npm run phone status',
  130429: 'Rate limit reached. The dispatcher will retry.',
  131056: 'Too many messages to this same recipient in a short period.',
  190: 'The access token is invalid or expired.',
  2388001: 'The number is still attached to a regular WhatsApp account and must be ' +
           'disconnected there first.'
};

export function explainMetaError(error) {
  const err = error.response?.data?.error;
  const code = err?.error_subcode || err?.code;
  return ERROR_GUIDANCE[code] || ERROR_GUIDANCE[err?.code] || null;
}

function logMetaError(label, recipientPhone, error) {
  const err = error.response?.data?.error;
  const message = err?.message || error.message;

  console.error(`❌ ${label} (${recipientPhone}): ${message}`);

  const guidance = explainMetaError(error);
  if (guidance) {
    console.error(`   → ${guidance}`);
  } else {
    console.error('   Full error:', error.response?.data);
  }
}

/**
 * Send a WhatsApp message via Meta Cloud API.
 * Requires: META_API_TOKEN, META_PHONE_NUMBER_ID
 */
export async function sendWhatsAppMessage(recipientPhone, messageText) {
  const apiToken = process.env.META_API_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  console.log(`📤 Sending message to ${recipientPhone}`);
  console.log(`   Token configured: ${!!apiToken}`);
  console.log(`   Phone ID configured: ${!!phoneNumberId}`);

  if (!apiToken || !phoneNumberId) {
    console.error('❌ Missing Meta credentials');
    throw new Error('META_API_TOKEN or META_PHONE_NUMBER_ID not configured');
  }

  try {
    console.log(`📲 Posting to Meta API: https://graph.facebook.com/v18.0/${phoneNumberId}/messages`);
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipientPhone,
        type: 'text',
        text: {
          body: messageText
        }
      },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const messageId = response.data.messages?.[0]?.id;
    console.log(`✅ Message sent! ID: ${messageId}`);
    return {
      success: true,
      messageId,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    logMetaError('Meta API Error', recipientPhone, error);
    throw new Error(`Failed to send WhatsApp message: ${errorMsg}`);
  }
}

/**
 * Report the account-level limits that stop a send before the code is
 * involved at all.
 *
 * A template to someone outside the 24-hour window is billable, so without a
 * payment method it fails — and an unverified business can only reach a
 * limited number of distinct people per day. Neither shows up as anything
 * other than a rejected send, which is a bad way to learn about them.
 */
export async function reportAccountLimits() {
  const apiToken = process.env.META_API_TOKEN;
  const wabaId = process.env.META_BUSINESS_ACCOUNT_ID;

  if (!apiToken || !wabaId) return;

  try {
    const response = await axios.get(`https://graph.facebook.com/v18.0/${wabaId}`, {
      params: {
        access_token: apiToken,
        fields: 'name,account_review_status,business_verification_status,message_template_namespace'
      },
      timeout: 10000
    });

    const a = response.data;
    console.log(`🏦 Account "${a.name}" — review: ${a.account_review_status || 'unknown'}, ` +
      `business verification: ${a.business_verification_status || 'unknown'}`);

    if (a.business_verification_status && a.business_verification_status !== 'verified') {
      console.warn('   ⚠️  Business not verified — capped at 250 distinct recipients per 24h');
    }
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.warn('🏦 Could not read account status:', detail);
  }

  // Messaging limits live on the phone number, not the account.
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  if (!phoneNumberId) return;

  try {
    const response = await axios.get(`https://graph.facebook.com/v18.0/${phoneNumberId}`, {
      params: { access_token: apiToken, fields: 'throughput,messaging_limit_tier' },
      timeout: 10000
    });

    const tier = response.data.messaging_limit_tier;
    if (tier) console.log(`   Messaging limit tier: ${tier}`);
  } catch {
    // Not every account exposes this; its absence is not worth a warning.
  }
}

/**
 * Report whether the number this service sends from is actually able to send.
 *
 * A number can sit in the dashboard looking configured while its status is
 * still PENDING, in which case every send fails for a reason that has nothing
 * to do with the code.
 */
export async function reportPhoneStatus() {
  const apiToken = process.env.META_API_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!apiToken || !phoneNumberId) return;

  try {
    const response = await axios.get(`https://graph.facebook.com/v18.0/${phoneNumberId}`, {
      params: {
        access_token: apiToken,
        fields: 'display_phone_number,verified_name,status,quality_rating,platform_type'
      },
      timeout: 10000
    });

    const p = response.data;
    console.log(`📱 Sending from ${p.display_phone_number} "${p.verified_name}" — ${p.status}`);

    if (p.status !== 'CONNECTED') {
      console.warn(`   ⚠️  Status is ${p.status}, not CONNECTED — sends will fail until it is`);
    }
    if (p.quality_rating && p.quality_rating !== 'GREEN') {
      console.warn(`   ⚠️  Quality rating is ${p.quality_rating}`);
    }
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.warn('📱 Could not read the sending number:', detail);
  }
}

/**
 * Report which templates Meta actually holds, and whether the one this
 * service is configured to send matches one of them.
 *
 * A name or language that does not match is rejected at send time with error
 * 132001 — hours after scheduling, when nobody is watching. Checking at
 * startup turns that into a line in the deploy log.
 */
export async function reportTemplateStatus() {
  const apiToken = process.env.META_API_TOKEN;
  const wabaId = process.env.META_BUSINESS_ACCOUNT_ID;
  const wantName = process.env.META_TEMPLATE_NAME || 'scheduled_message_reminder';
  const wantLang = process.env.META_TEMPLATE_LANGUAGE || 'he';

  console.log(`📄 Template configured: "${wantName}" (${wantLang})`);

  if (!apiToken || !wabaId) {
    console.warn('   Cannot verify — META_API_TOKEN or META_BUSINESS_ACCOUNT_ID missing');
    return;
  }

  try {
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${wabaId}/message_templates`,
      { params: { access_token: apiToken, limit: 50 }, timeout: 10000 }
    );

    const templates = response.data.data || [];
    if (templates.length === 0) {
      console.warn('   ⚠️  This WhatsApp account holds no templates at all');
      return;
    }

    console.log('   Available:');
    for (const t of templates) {
      console.log(`     "${t.name}" (${t.language}) — ${t.status}`);
    }

    const exact = templates.find(t => t.name === wantName && t.language === wantLang);
    if (exact) {
      console.log(exact.status === 'APPROVED'
        ? '   ✅ Configured template matches and is approved'
        : `   ⚠️  Configured template matches but its status is ${exact.status}`);
      return;
    }

    const sameName = templates.filter(t => t.name === wantName);
    if (sameName.length > 0) {
      console.warn(
        `   ⚠️  Name matches but language does not. Set META_TEMPLATE_LANGUAGE to ` +
        `one of: ${sameName.map(t => t.language).join(', ')}`
      );
    } else {
      console.warn(
        `   ⚠️  No template named "${wantName}". Set META_TEMPLATE_NAME to one of: ` +
        templates.map(t => t.name).join(', ')
      );
    }
  } catch (error) {
    console.warn('   Could not read templates:', error.response?.data?.error?.message || error.message);
  }
}

/**
 * Send a voice note by re-using the media id Meta gave us on the way in.
 *
 * Audio cannot travel inside a template, so this only reaches someone inside
 * the 24-hour service window — callers must check before choosing this path.
 */
export async function sendAudioMessage(recipientPhone, mediaId) {
  const apiToken = process.env.META_API_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!apiToken || !phoneNumberId) {
    throw new Error('META_API_TOKEN or META_PHONE_NUMBER_ID not configured');
  }

  console.log(`🔊 Sending voice note ${mediaId} to ${recipientPhone}`);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipientPhone,
        type: 'audio',
        audio: { id: mediaId }
      },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const messageId = response.data.messages?.[0]?.id;
    console.log(`✅ Voice note sent! ID: ${messageId}`);
    return { success: true, messageId, timestamp: new Date().toISOString() };
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    logMetaError('Meta Audio Error', recipientPhone, error);
    throw new Error(`Failed to send voice note: ${errorMsg}`);
  }
}

/**
 * Send an image or a video, optionally with a caption.
 *
 * Like audio, media cannot travel inside the approved template, so this only
 * reaches someone inside the 24-hour service window.
 */
export async function sendMediaMessage(recipientPhone, mediaId, mediaType, caption = null) {
  const apiToken = process.env.META_API_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!apiToken || !phoneNumberId) {
    throw new Error('META_API_TOKEN or META_PHONE_NUMBER_ID not configured');
  }
  if (mediaType !== 'image' && mediaType !== 'video') {
    throw new Error(`Unsupported media type: ${mediaType}`);
  }

  const payload = { id: mediaId };
  if (caption) payload.caption = caption.slice(0, 1024);

  console.log(`🖼️  Sending ${mediaType} ${mediaId} to ${recipientPhone}`);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipientPhone,
        type: mediaType,
        [mediaType]: payload
      },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    const messageId = response.data.messages?.[0]?.id;
    console.log(`✅ ${mediaType} sent! ID: ${messageId}`);
    return { success: true, messageId, timestamp: new Date().toISOString() };
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    logMetaError('Meta Media Error', recipientPhone, error);
    throw new Error(`Failed to send ${mediaType}: ${errorMsg}`);
  }
}

/**
 * Send an approved template message.
 *
 * Templates are the only way to reach someone outside the 24-hour service
 * window. `parameters` fill the template's {{1}}, {{2}}, … placeholders in
 * order, so their count must match what Meta approved or the send is rejected.
 */
export async function sendTemplateMessage(recipientPhone, templateName, templateLanguage = 'he', parameters = []) {
  const apiToken = process.env.META_API_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!apiToken || !phoneNumberId) {
    throw new Error('META_API_TOKEN or META_PHONE_NUMBER_ID not configured');
  }

  const template = {
    name: templateName,
    language: { code: templateLanguage }
  };

  if (parameters.length > 0) {
    template.components = [{
      type: 'body',
      parameters: parameters.map(text => ({ type: 'text', text: String(text) }))
    }];
  }

  console.log(`📄 Sending template "${templateName}" to ${recipientPhone} (${parameters.length} params)`);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipientPhone,
        type: 'template',
        template
      },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const messageId = response.data.messages?.[0]?.id;
    console.log(`✅ Template sent! ID: ${messageId}`);
    return {
      success: true,
      messageId,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    logMetaError('Meta Template Error', recipientPhone, error);
    throw new Error(`Failed to send template message: ${errorMsg}`);
  }
}
