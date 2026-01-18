const express = require('express');
const Material = require('../models/Material');
const User = require('../models/User');
const NotificationPreferences = require('../models/NotificationPreferences');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

const router = express.Router();

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const materialCreateSchema = z.object({
  name: z.string().min(1),
  quantity: z.union([z.number(), z.string()]).optional(),
  unit: z.string().optional(),
  materialPrice: z.union([z.number(), z.string()]).optional(),
  labourPrice: z.union([z.number(), z.string()]).optional(),
  price: z.union([z.number(), z.string()]).optional(),
  location: z.string().optional(),
  panel: z.string().optional(),
  circuit: z.string().optional(),
  receivedAt: z.any().optional()
});

const materialUpdateSchema = materialCreateSchema.partial();

const materialPriceSchema = z.object({
  price: z.union([z.number(), z.string()])
});

const getLowStockThreshold = () => {
  const value = Number(process.env.LOW_STOCK_THRESHOLD);
  if (Number.isFinite(value) && value >= 0) return value;
  return 5;
};

const notifyLowStockIfNeeded = async ({ material, prevQuantity, triggeredBy }) => {
  const threshold = getLowStockThreshold();
  if (!Number.isFinite(material.quantity)) return;
  if (threshold < 0) return;
  if (material.quantity > threshold) return;
  if (Number.isFinite(prevQuantity) && prevQuantity <= threshold) return;

  const recipients = await User.find({
    company: material.company,
    site: material.site
  }).select('_id');

  const uniqueIds = Array.from(new Set(recipients.map((u) => String(u._id))));
  await Promise.all(
    uniqueIds.map((id) =>
      NotificationPreferences.sendNotificationIfAllowed(id, {
        recipient: id,
        sender: triggeredBy,
        title: `Low stock: ${material.name}`,
        message: `Only ${material.quantity} ${material.unit || ''} left. Please restock.`,
        type: 'low_stock',
        priority: 'high',
        data: {
          materialId: String(material._id),
          quantity: material.quantity,
          threshold
        }
      })
    )
  );
};

router.get('/', authenticateToken, requireActiveSite, async (req, res, next) => {
  try {
    // Allow all users to see materials scoped to their company/site so they can use them in reports/receipts
    const query = { company: req.user.company, site: req.user.site };
    const materials = await Material.find(query).sort({ createdAt: -1 });
    return res.json({ materials });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticateToken, requireActiveSite, validate(materialCreateSchema), async (req, res, next) => {
  try {
    const { name, quantity = 0, unit, materialPrice = 0, labourPrice = 0, price, location, panel, circuit, receivedAt } = req.data;
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
    await notifyLowStockIfNeeded({
      material,
      prevQuantity: Number.POSITIVE_INFINITY,
      triggeredBy: req.user.id
    });
    return res.status(201).json({ material });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Material name already exists' });
    }
    return next(err);
  }
});

router.put(
  '/:id',
  authenticateToken,
  requireActiveSite,
  validate(idParamsSchema, { source: 'params' }),
  validate(materialUpdateSchema),
  async (req, res, next) => {
  try {
    const { name, quantity, unit, materialPrice, labourPrice, price, location, panel, circuit, receivedAt } = req.data;
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
    const existing = await Material.findOne(filter);
    if (!existing) {
      return res.status(404).json({ message: 'Material not found' });
    }
    const material = await Material.findOneAndUpdate(filter, updates, { new: true });
    if (!material) {
      return res.status(404).json({ message: 'Material not found' });
    }
    await notifyLowStockIfNeeded({
      material,
      prevQuantity: existing.quantity,
      triggeredBy: req.user.id
    });
    return res.json({ material });
  } catch (err) {
    return next(err);
  }
});

router.put(
  '/:id/price',
  authenticateToken,
  requireActiveSite,
  validate(idParamsSchema, { source: 'params' }),
  validate(materialPriceSchema),
  async (req, res, next) => {
  try {
    const { price } = req.data;
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

router.delete('/:id', authenticateToken, requireActiveSite, validate(idParamsSchema, { source: 'params' }), async (req, res, next) => {
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

