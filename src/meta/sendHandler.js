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
