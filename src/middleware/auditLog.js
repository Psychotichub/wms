const AuditLog = require('../models/AuditLog');

const SENSITIVE_KEYS = new Set([
  'password',
  'refreshToken',
  'token',
  'emailVerificationCode',
  'emailVerificationToken',
  'authorization',
  'pushToken',
  'WEB_PUSH_VAPID_PRIVATE_KEY'
]);

function summarizeBody(body, maxLen = 800) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const clone = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE_KEYS.has(k)) {
      clone[k] = '[redacted]';
    } else if (typeof v === 'object' && v !== null) {
      clone[k] = '[object]';
    } else {
      clone[k] = v;
    }
  }
  try {
    const s = JSON.stringify(clone);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return null;
  }
}

const SKIP_PREFIXES = ['/health', '/api-docs'];

function shouldSkipPath(urlPath) {
  return SKIP_PREFIXES.some((p) => urlPath === p || urlPath.startsWith(`${p}/`));
}

/**
 * Records mutating API calls after the response is finished (req.user is set by route auth).
 */
function auditLogMiddleware(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const pathOnly = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;
  if (shouldSkipPath(pathOnly)) {
    return next();
  }

  if (!pathOnly.startsWith('/api')) {
    return next();
  }

  res.on('finish', () => {
    try {
      const actorId = req.user?.id || req.user?.userId || null;
      const payloadSummary = summarizeBody(req.body);
      const ip =
        (typeof req.ip === 'string' && req.ip) ||
        (typeof req.headers['x-forwarded-for'] === 'string'
          ? req.headers['x-forwarded-for'].split(',')[0].trim()
          : '') ||
        req.socket?.remoteAddress ||
        '';

      AuditLog.create({
        ...(actorId ? { actorId } : {}),
        method: req.method,
        path: pathOnly,
        statusCode: res.statusCode,
        ip,
        payloadSummary
      }).catch(() => {});
    } catch {
      /* ignore audit failures */
    }
  });

  next();
}

module.exports = { auditLogMiddleware, summarizeBody };
