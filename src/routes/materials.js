const express = require('express');
const Material = require('../models/Material');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    // Allow all users to see materials scoped to their company/site so they can use them in reports/receipts
    const query = { company: req.user.company, site: req.user.site };
    const materials = await Material.find(query).sort({ createdAt: -1 });
    return res.json({ materials });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { name, quantity = 0, unit, materialPrice = 0, labourPrice = 0, price, location, panel, circuit, receivedAt } = req.body;
    const existing = await Material.findOne({
      name,
      company: req.user.company,
      site: req.user.site
    });
    if (existing) {
      return res.status(400).json({ message: 'Material name already exists' });
    }

    const totalPrice = Number.isFinite(price) ? price : Number(materialPrice) + Number(labourPrice);
    const material = await Material.create({
      name,
      quantity,
      unit,
      materialPrice,
      labourPrice,
      price: totalPrice,
      location,
      panel,
      circuit,
      receivedAt,
      company: req.user.company,
      site: req.user.site,
      createdBy: req.user.id
    });
    return res.status(201).json({ material });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Material name already exists' });
    }
    return next(err);
  }
});

router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { name, quantity, unit, materialPrice, labourPrice, price, location, panel, circuit, receivedAt } = req.body;
    const updates = {
      ...(name !== undefined && { name }),
      ...(quantity !== undefined && { quantity }),
      ...(unit !== undefined && { unit }),
      ...(materialPrice !== undefined && { materialPrice }),
      ...(labourPrice !== undefined && { labourPrice }),
      ...(price !== undefined && { price }),
      ...(location !== undefined && { location }),
      ...(panel !== undefined && { panel }),
      ...(circuit !== undefined && { circuit }),
      ...(receivedAt !== undefined && { receivedAt })
    };

    // Recompute total price if parts provided without explicit price
    if (price === undefined && (materialPrice !== undefined || labourPrice !== undefined)) {
      const mat = materialPrice !== undefined ? Number(materialPrice) : 0;
      const lab = labourPrice !== undefined ? Number(labourPrice) : 0;
      updates.price = mat + lab;
    }

    if (name) {
      const existing = await Material.findOne({
        name,
        company: req.user.company,
        site: req.user.site,
        _id: { $ne: req.params.id }
      });
      if (existing) {
        return res.status(400).json({ message: 'Material name already exists' });
      }
    }

    const baseFilter = { _id: req.params.id, company: req.user.company, site: req.user.site };
    const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, createdBy: req.user.id };
    const material = await Material.findOneAndUpdate(filter, updates, { new: true });
    if (!material) {
      return res.status(404).json({ message: 'Material not found' });
    }
    return res.json({ material });
  } catch (err) {
    return next(err);
  }
});

router.put('/:id/price', authenticateToken, async (req, res, next) => {
  try {
    const { price } = req.body;
    const filter = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, createdBy: req.user.id };
    const material = await Material.findOneAndUpdate(filter, { price }, { new: true });
    if (!material) {
      return res.status(404).json({ message: 'Material not found' });
    }
    return res.json({ material });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const baseFilter = { _id: req.params.id, company: req.user.company, site: req.user.site };
    const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, createdBy: req.user.id };
    const deleted = await Material.findOneAndDelete(filter);
    if (!deleted) {
      return res.status(404).json({ message: 'Material not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

