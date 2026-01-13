const express = require('express');
const Panel = require('../models/Panel');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    // Allow all users to see panels for their company/site
    const query = { company: req.user.company, site: req.user.site };
    const panels = await Panel.find(query).sort({ createdAt: -1 });
    return res.json({ panels });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { name, circuit } = req.body;
    const existing = await Panel.findOne({
      name,
      circuit,
      company: req.user.company,
      site: req.user.site
    });
    if (existing) {
      return res.status(400).json({ message: 'Panel + circuit already exists' });
    }
    const panel = await Panel.create({
      name,
      circuit,
      company: req.user.company,
      site: req.user.site,
      createdBy: req.user.id
    });
    return res.status(201).json({ panel });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Panel + circuit already exists' });
    }
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Panel + circuit already exists' });
    }
    return next(err);
  }
});

router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { name, circuit } = req.body;
    const baseFilter = { _id: req.params.id, company: req.user.company, site: req.user.site };
    const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, createdBy: req.user.id };
    const current = await Panel.findOne(filter);
    if (!current) {
      return res.status(404).json({ message: 'Panel not found' });
    }

    const nextName = name !== undefined ? name : current.name;
    const nextCircuit = circuit !== undefined ? circuit : current.circuit;

    const existing = await Panel.findOne({
      name: nextName,
      circuit: nextCircuit,
      company: req.user.company,
      site: req.user.site,
      _id: { $ne: req.params.id }
    });
    if (existing) {
      return res.status(400).json({ message: 'Panel + circuit already exists' });
    }

    current.name = nextName;
    current.circuit = nextCircuit;
    await current.save();
    return res.json({ panel: current });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Panel + circuit already exists' });
    }
    return next(err);
  }
});

router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const baseFilter = { _id: req.params.id, company: req.user.company, site: req.user.site };
    const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, createdBy: req.user.id };
    const deleted = await Panel.findOneAndDelete(filter);
    if (!deleted) {
      return res.status(404).json({ message: 'Panel not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

