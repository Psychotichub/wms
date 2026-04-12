const express = require('express');
const AuditLog = require('../models/AuditLog');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { parsePageLimit } = require('../utils/pagination');

const router = express.Router();

router.get('/logs', authenticateToken, requireAdmin, async (req, res) => {
  const { page, limit, skip } = parsePageLimit(req.query, { defaultLimit: 40, maxLimit: 100 });
  const filter = {};
  if (req.query.actorId) {
    filter.actorId = req.query.actorId;
  }
  if (req.query.pathPrefix) {
    filter.path = { $regex: `^${String(req.query.pathPrefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
  }

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter)
  ]);

  res.json({
    logs: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0
    }
  });
});

module.exports = router;
