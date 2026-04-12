/**
 * @param {Record<string, unknown>} query - req.query
 * @param {{ defaultLimit?: number, maxLimit?: number }} [opts]
 */
function parsePageLimit(query, opts = {}) {
  const defaultLimit = opts.defaultLimit ?? 50;
  const maxLimit = opts.maxLimit ?? 200;
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  let limit = parseInt(String(query.limit ?? String(defaultLimit)), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  limit = Math.min(maxLimit, limit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

module.exports = { parsePageLimit };
