import axios from 'axios';

const GRAPH = 'https://graph.facebook.com/v18.0';

/**
 * Make sure this app receives the WhatsApp account's webhooks.
 *
 * Verifying the callback URL in the Meta dashboard is NOT the same as being
 * subscribed to the account, and nothing in the dashboard says so: the URL
 * check passes, everything looks configured, and not one message arrives.
 * That cost a full night of debugging once. Checking it at every boot means a
 * move to another WhatsApp account can never reintroduce it.
 */
export async function ensureWebhookSubscription() {
  const apiToken = process.env.META_API_TOKEN;
  const wabaId = process.env.META_BUSINESS_ACCOUNT_ID;
  const appId = process.env.META_APP_ID || null;

  if (!apiToken || !wabaId) {
    console.warn('🔗 Webhook subscription: cannot verify — token or account id missing');
    return;
  }

  try {
    const subscribed = await listSubscribedApps(apiToken, wabaId);

    if (subscribed === null) {
      return; // already reported
    }

    const names = subscribed.map(a => `${a.name} (${a.id})`);
    console.log(`🔗 Webhook subscription on ${wabaId}: ${names.join(', ') || 'none'}`);

    // With an app id we can be certain; without one, an empty list is the
    // only case we can act on confidently.
    const ours = appId ? subscribed.some(a => a.id === appId) : subscribed.length > 0;

    if (ours) {
      console.log('   ✅ Subscribed');
      return;
    }

    console.warn('   ⚠️  Not subscribed — subscribing now');
    await axios.post(`${GRAPH}/${wabaId}/subscribed_apps`, null, {
      params: { access_token: apiToken },
      timeout: 10000
    });

    const after = await listSubscribedApps(apiToken, wabaId);
    console.log(after && after.length > 0
      ? `   ✅ Subscribed: ${after.map(a => a.name).join(', ')}`
      : '   ❌ Subscription did not take effect — messages will not arrive');
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.error('🔗 Webhook subscription failed:', detail);
    console.error('   Incoming messages will not reach this service until this is fixed.');
  }
}

async function listSubscribedApps(apiToken, wabaId) {
  try {
    const response = await axios.get(`${GRAPH}/${wabaId}/subscribed_apps`, {
      params: { access_token: apiToken },
      timeout: 10000
    });
    return (response.data.data || []).map(entry => ({
      id: entry.whatsapp_business_api_data?.id,
      name: entry.whatsapp_business_api_data?.name
    }));
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.warn('🔗 Webhook subscription: could not read subscriptions —', detail);
    return null;
  }
}
