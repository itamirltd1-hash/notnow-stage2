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
    console.log(`📲 Posting to Meta API: https://graph.instagram.com/v18.0/${phoneNumberId}/messages`);
    const response = await axios.post(
      `https://graph.instagram.com/v18.0/${phoneNumberId}/messages`,
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
 * Send a template message (for future use with Meta templates).
 */
export async function sendTemplateMessage(recipientPhone, templateName, templateLanguage = 'en') {
  const apiToken = process.env.META_API_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!apiToken || !phoneNumberId) {
    throw new Error('META_API_TOKEN or META_PHONE_NUMBER_ID not configured');
  }

  try {
    const response = await axios.post(
      `https://graph.instagram.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipientPhone,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: templateLanguage
          }
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

    return {
      success: true,
      messageId: response.data.messages?.[0]?.id,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    console.error(`❌ Meta Template Error (${recipientPhone}):`, errorMsg);
    throw new Error(`Failed to send template message: ${errorMsg}`);
  }
}
