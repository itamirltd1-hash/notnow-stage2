/**
 * Middleware: Require user ID from request context (session or API key).
 * Attaches req.userId to the request object.
 */
export function requireUser(req, res, next) {
  // Try session-based auth first (future web dashboard)
  if (req.session?.userId) {
    req.userId = req.session.userId;
    return next();
  }

  // Try API key auth (Enterprise, Cycle 5)
  if (req.headers['x-api-key']) {
    // This will be populated in Cycle 5 by API key validation middleware
    if (req.userId) {
      return next();
    }
  }

  return res.status(401).json({ success: false, error: 'Unauthorized' });
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
