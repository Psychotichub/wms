const express = require('express');
const Setting = require('../models/Setting');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

const router = express.Router();

const upsertSettingSchema = z.object({
  key: z.string().min(1),
  value: z.any()
});

router.get('/', authenticateToken, requireAdmin, async (_req, res, next) => {
  try {
    const settings = await Setting.find();
    return res.json({ settings });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticateToken, requireAdmin, validate(upsertSettingSchema), async (req, res, next) => {
  try {
    const { key, value } = req.data;
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

