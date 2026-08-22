import axios from 'axios';
import crypto from 'crypto';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_KEY = process.env.STRIPE_API_KEY;

const STRIPE_PRICES = {
  BASIC: { name: 'BASIC', price_id: 'price_basic_39_ils', amount: 3900, currency: 'ils' },
  PRO: { name: 'PRO', price_id: 'price_pro_119_ils', amount: 11900, currency: 'ils' },
  ENTERPRISE: { name: 'ENTERPRISE', price_id: 'price_ent_349_ils', amount: 34900, currency: 'ils' }
};

/**
 * Create a Stripe Checkout Session for tier upgrade.
 * Returns checkout URL.
 */
export async function createCheckoutSession(userId, targetTier, successUrl, cancelUrl) {
  try {
    if (!STRIPE_PRICES[targetTier]) {
      throw new Error(`Invalid tier: ${targetTier}`);
    }

    const priceInfo = STRIPE_PRICES[targetTier];

    const params = new URLSearchParams();
    params.append('customer_email', `user_${userId}@notnow.local`);
    params.append('line_items[0][price]', priceInfo.price_id);
    params.append('line_items[0][quantity]', '1');
    params.append('mode', 'subscription');
    params.append('success_url', successUrl);
    params.append('cancel_url', cancelUrl);
    params.append('metadata[user_id]', userId.toString());
    params.append('metadata[tier]', targetTier);

    const response = await axios.post(
      `${STRIPE_API_BASE}/checkout/sessions`,
      params,
      {
        auth: {
          username: STRIPE_KEY,
          password: ''
        }
      }
    );

    return {
      sessionId: response.data.id,
      checkoutUrl: response.data.url
    };
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error.message);
    throw error;
  }
}

/**
 * Retrieve a Stripe Checkout Session (to verify payment).
 */
export async function retrieveCheckoutSession(sessionId) {
  try {
    const response = await axios.get(
      `${STRIPE_API_BASE}/checkout/sessions/${sessionId}`,
      {
        auth: {
          username: STRIPE_KEY,
          password: ''
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error retrieving checkout session:', error.message);
    throw error;
  }
}

/**
 * Verify a Stripe webhook signature.
 * Uses HMAC-SHA256 with Stripe's webhook secret.
 * Returns true if signature is valid, false otherwise.
 */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || !signature || !rawBody) {
    console.warn('⚠️ Stripe webhook validation failed: missing secret, signature, or body');
    return false;
  }

  try {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expected = `t=${Date.now()},v1=${hash}`;

    // Stripe sends signature as "t=timestamp,v1=hash,..."
    // We verify the v1 hash
    if (signature.includes(`v1=${hash}`)) {
      return true;
    }

    console.error('❌ Invalid Stripe webhook signature - possible tampering');
    return false;
  } catch (error) {
    console.error('❌ Error verifying Stripe signature:', error.message);
    return false;
  }
}

/**
 * Extract metadata from Stripe webhook event.
 * Returns { user_id, tier } from the subscription metadata.
 */
export function extractMetadataFromWebhook(body) {
  try {
    const event = body;
    const subscription = event.data?.object;

    if (!subscription?.metadata) {
      return null;
    }

    return {
      user_id: parseInt(subscription.metadata.user_id, 10),
      tier: subscription.metadata.tier,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer
    };
  } catch (error) {
    console.error('Error extracting webhook metadata:', error.message);
    return null;
  }
}
