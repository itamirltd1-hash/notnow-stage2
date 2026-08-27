/**
 * Middleware: Require user ID from request context (session, API key, or test override).
 * Attaches req.userId to the request object.
 */
export function requireUser(req, res, next) {
  // Try session-based auth first (future web dashboard)
  if (req.session?.userId) {
    req.userId = req.session.userId;
    return next();
  }

  // Try API key auth (Enterprise, Cycle 5)
  const apiKey = req.headers['x-api-key'];
  if (apiKey && process.env.VALID_API_KEYS?.includes(apiKey)) {
    // In production, extract userId from API key mapping
    // For now, allow with a test user ID
    req.userId = process.env.TEST_USER_ID || 1;
    return next();
  }

  // X-User-ID impersonates any account, so it is off unless switched on
  // deliberately. It used to key off NODE_ENV, which is unset on most hosts —
  // meaning the header was live in production and anyone could pass any id.
  const testUserId = req.headers['x-user-id'];
  if (testUserId && process.env.ALLOW_TEST_AUTH === 'true') {
    console.warn(`⚠️  Test auth used: acting as user ${testUserId}`);
    req.userId = parseInt(testUserId, 10);
    return next();
  }

  return res.status(401).json({ success: false, error: 'Unauthorized - missing or invalid credentials' });
}

/**
 * Middleware: Enforce user_id path parameter matches authenticated user.
 */
export function enforceUserOwnership(req, res, next) {
  const pathUserId = parseInt(req.params.userId, 10);
  const sessionUserId = req.session?.userId;

  if (pathUserId !== sessionUserId) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  next();
}
