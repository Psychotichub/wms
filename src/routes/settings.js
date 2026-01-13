const express = require('express');
const Setting = require('../models/Setting');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticateToken, requireAdmin, async (_req, res, next) => {
  try {
    const settings = await Setting.find();
    return res.json({ settings });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { key, value } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key },
      { value, updatedBy: req.user.id },
      { upsert: true, new: true }
    );
    return res.status(201).json({ setting });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

