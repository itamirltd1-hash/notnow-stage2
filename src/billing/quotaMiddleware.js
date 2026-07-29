import pool from '../db/pool.js';

const TIER_LIMITS = {
  FREE: 10,
  BASIC: 100,
  PRO: 400,
  ENTERPRISE: 3000
};

/**
 * Check if user is within their monthly quota.
 * Returns { allowed: true/false, remaining, limit }.
 */
export async function checkUserQuota(userId) {
  try {
    // Get user tier
    const userResult = await pool.query('SELECT tier FROM users WHERE user_id = $1', [userId]);
    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const tier = userResult.rows[0].tier;
    const limit = TIER_LIMITS[tier] || TIER_LIMITS.FREE;

    // Get current month's usage
    const currentMonth = new Date().toISOString().split('T')[0].slice(0, 7) + '-01';
    const usageResult = await pool.query(
      'SELECT message_count FROM monthly_usage WHERE user_id = $1 AND month = $2',
      [userId, currentMonth]
    );

    const count = usageResult.rows[0]?.message_count || 0;
    const remaining = Math.max(0, limit - count);

    return {
      allowed: remaining > 0,
      used: count,
      remaining,
      limit,
      tier
    };
  } catch (error) {
    console.error('Error checking user quota:', error.message);
    return {
      allowed: false,
      error: error.message
    };
  }
}

/**
 * Increment user's monthly message count.
 */
export async function incrementMonthlyUsage(userId) {
  try {
    const currentMonth = new Date().toISOString().split('T')[0].slice(0, 7) + '-01';

    // Get user tier
    const userResult = await pool.query('SELECT tier FROM users WHERE user_id = $1', [userId]);
    const tier = userResult.rows[0]?.tier || 'FREE';

    // Increment or create usage record
    const result = await pool.query(
      `INSERT INTO monthly_usage (user_id, month, message_count, tier_snapshot)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (user_id, month) DO UPDATE
       SET message_count = message_count + 1
       RETURNING message_count`,
      [userId, currentMonth, tier]
    );

    return result.rows[0].message_count;
  } catch (error) {
    console.error('Error incrementing usage:', error.message);
    throw error;
  }
}

/**
 * Reset monthly usage counter for a user (called when tier is upgraded).
 */
export async function resetMonthlyUsage(userId) {
  try {
    const currentMonth = new Date().toISOString().split('T')[0].slice(0, 7) + '-01';

    const result = await pool.query(
      `UPDATE monthly_usage SET message_count = 0 WHERE user_id = $1 AND month = $2 RETURNING *`,
      [userId, currentMonth]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error('Error resetting usage:', error.message);
    throw error;
  }
}

/**
 * Express middleware: Check quota before allowing message queue.
 */
export async function enforceQuota(req, res, next) {
  if (!req.userId) {
    return next();
  }

  const quota = await checkUserQuota(req.userId);

  if (!quota.allowed) {
    return res.status(429).json({
      success: false,
      error: 'Quota exceeded',
      quota: {
        used: quota.used,
        limit: quota.limit,
        remaining: 0,
        tier: quota.tier,
        upgrade_url: generateUpgradeLink(quota.tier)
      }
    });
  }

  req.quota = quota;
  next();
}

/**
 * Generate a Stripe Checkout link for upgrading tier.
 */
export function generateUpgradeLink(currentTier) {
  // This is a placeholder — in production, you'd generate actual Stripe Checkout URLs
  return `${process.env.APP_URL || 'http://localhost:3000'}/billing/upgrade?from=${currentTier}`;
}
