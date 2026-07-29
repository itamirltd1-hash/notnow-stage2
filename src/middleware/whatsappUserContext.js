import { getUserByPhone } from '../auth/userContextExtractor.js';

/**
 * Middleware: Extract WhatsApp sender phone from Meta webhook payload.
 * Query user database and attach user context to request.
 *
 * Expected req.body format (Meta webhook):
 * {
 *   "entry": [{
 *     "changes": [{
 *       "value": {
 *         "messages": [{
 *           "from": "+972501234567",
 *           "text": { "body": "..." }
 *         }]
 *       }
 *     }]
 *   }]
 * }
 */
export async function extractWhatsappUserContext(req, res, next) {
  try {
    // Parse incoming Meta webhook
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;

    if (!messages || messages.length === 0) {
      // Not a message event, skip
      return next();
    }

    const message = messages[0];
    const senderPhone = message.from;

    if (!senderPhone) {
      return res.status(400).json({ success: false, error: 'Missing sender phone' });
    }

    // Look up user by phone number
    const user = await getUserByPhone(senderPhone);

    if (!user) {
      // Unknown sender — store context but mark as unregistered
      req.senderPhone = senderPhone;
      req.userId = null;
      req.isUnknownSender = true;
      return next();
    }

    // Attach user context to request
    req.userId = user.user_id;
    req.userEmail = user.email;
    req.userTier = user.tier;
    req.senderPhone = senderPhone;
    req.isUnknownSender = false;

    next();
  } catch (error) {
    console.error('Error extracting WhatsApp user context:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * Guard: Ensure user is known (not an unknown sender).
 */
export function requireKnownSender(req, res, next) {
  if (req.isUnknownSender || !req.userId) {
    return res.status(403).json({
      success: false,
      error: 'Unknown sender. Please register first.'
    });
  }
  next();
}
