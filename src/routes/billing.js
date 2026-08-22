import express from 'express';
import { requireUser } from '../middleware/requireUser.js';
import { createCheckoutSession, extractMetadataFromWebhook, verifyWebhookSignature } from '../billing/stripeClient.js';
import { resetMonthlyUsage } from '../billing/quotaMiddleware.js';
import pool from '../db/pool.js';

const router = express.Router();

/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout session for tier upgrade.
 */
router.post('/checkout', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const { target_tier } = req.body;

    if (!target_tier) {
      return res.status(400).json({ success: false, error: 'Missing target_tier' });
    }

    const successUrl = `${process.env.APP_URL || 'http://localhost:3000'}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${process.env.APP_URL || 'http://localhost:3000'}/billing/cancel`;

    const { sessionId, checkoutUrl } = await createCheckoutSession(userId, target_tier, successUrl, cancelUrl);

    res.json({
      success: true,
      data: {
        sessionId,
        checkoutUrl
      }
    });
  } catch (error) {
    console.error('Error creating checkout session:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create checkout session' });
  }
});

/**
 * POST /api/billing/webhook
 * Stripe webhook listener for successful payments.
 * Called when a subscription is created/updated.
 * Signature verification required to prevent forged events.
 */
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.rawBody;

    // Verify Stripe webhook signature
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('🚨 SECURITY: Rejected webhook with invalid Stripe signature');
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }

    const event = req.body;

    // Handle subscription.created or subscription.updated events
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const metadata = extractMetadataFromWebhook(event);

      if (!metadata) {
        return res.status(400).json({ success: false, error: 'Invalid webhook format' });
      }

      const { user_id, tier, stripe_subscription_id, stripe_customer_id } = metadata;

      // Update user tier
      await pool.query(
        'UPDATE users SET tier = $1, updated_at = NOW() WHERE user_id = $2',
        [tier, user_id]
      );

      // Update subscription record
      await pool.query(
        `UPDATE subscriptions SET tier = $1, stripe_customer_id = $2, message_count_this_month = 0, month_reset_date = CURRENT_DATE, updated_at = NOW()
         WHERE user_id = $3`,
        [tier, stripe_customer_id, user_id]
      );

      // Reset monthly usage
      await resetMonthlyUsage(user_id);

      console.log(`✅ Tier upgraded: user=${user_id}, tier=${tier}`);

      return res.json({ success: true, data: { user_id, tier } });
    }

    // Log other event types (customer.subscription.deleted, etc.)
    console.log(`Stripe webhook event: ${event.type}`);
    res.json({ success: true, data: { event_type: event.type } });
  } catch (error) {
    console.error('Error processing Stripe webhook:', error.message);
    res.status(500).json({ success: false, error: 'Failed to process webhook' });
  }
});

/**
 * GET /api/billing/quota
 * Check current user's quota status.
 */
router.get('/quota', requireUser, async (req, res) => {
  try {
    const userId = req.userId;

    // Get user tier
    const userResult = await pool.query('SELECT tier FROM users WHERE user_id = $1', [userId]);
    const tier = userResult.rows[0]?.tier || 'FREE';

    // Get current month's usage
    const currentMonth = new Date().toISOString().split('T')[0].slice(0, 7) + '-01';
    const usageResult = await pool.query(
      'SELECT message_count FROM monthly_usage WHERE user_id = $1 AND month = $2',
      [userId, currentMonth]
    );

    const TIER_LIMITS = { FREE: 10, BASIC: 100, PRO: 400, ENTERPRISE: 3000 };
    const limit = TIER_LIMITS[tier] || 10;
    const used = usageResult.rows[0]?.message_count || 0;

    res.json({
      success: true,
      data: {
        tier,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        percentage: Math.round((used / limit) * 100)
      }
    });
  } catch (error) {
    console.error('Error fetching quota:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch quota' });
  }
});

export default router;
