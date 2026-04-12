const IdempotencyKey = require('../models/IdempotencyKey');

function getClientKey(req) {
  const raw = req.get('Idempotency-Key');
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim();
  if (key.length < 8 || key.length > 200) return null;
  return key;
}

/**
 * @returns {Promise<{ statusCode: number, body: object } | null>}
 */
async function idempotencyGet(req, routeKey) {
  const key = getClientKey(req);
  if (!key) return null;
  const userId = req.user?.id;
  if (!userId) return null;
  const doc = await IdempotencyKey.findOne({ userId, key, routeKey }).lean();
  if (!doc) return null;
  try {
    return { statusCode: doc.statusCode, body: JSON.parse(doc.responseBody) };
  } catch {
    return null;
  }
}

/**
 * Persist successful (2xx) response for idempotent replay.
 */
async function idempotencySet(req, routeKey, statusCode, bodyObj) {
  const key = getClientKey(req);
  if (!key) return;
  const userId = req.user?.id;
  if (!userId) return;
  if (statusCode < 200 || statusCode >= 300) return;
  try {
    await IdempotencyKey.findOneAndUpdate(
      { userId, key, routeKey },
      { $set: { statusCode, responseBody: JSON.stringify(bodyObj) } },
      { upsert: true, new: true }
    );
  } catch {
    /* ignore duplicate races */
  }
}

module.exports = { idempotencyGet, idempotencySet, getClientKey };
