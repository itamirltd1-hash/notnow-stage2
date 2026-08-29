import axios from 'axios';

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
    console.error(`❌ Meta API Error (${recipientPhone}):`, errorMsg);
    console.error(`   Status: ${error.response?.status}`);
    console.error(`   Full error:`, error.response?.data);
    throw new Error(`Failed to send WhatsApp message: ${errorMsg}`);
  }
}

/**
 * Report which templates Meta actually holds, and whether the one this
 * service is configured to send matches one of them.
 *
 * A name or language that does not match is rejected at send time with
 * error 132001 — hours after scheduling, when nobody is watching. Checking
 * at startup turns that into a line in the deploy log.
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
    console.error(`❌ Meta Audio Error (${recipientPhone}):`, errorMsg);
    console.error(`   Full error:`, error.response?.data);
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
    console.error(`❌ Meta Media Error (${recipientPhone}):`, errorMsg);
    console.error(`   Full error:`, error.response?.data);
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
    console.error(`❌ Meta Template Error (${recipientPhone}):`, errorMsg);
    console.error(`   Full error:`, error.response?.data);
    throw new Error(`Failed to send template message: ${errorMsg}`);
  }
}
