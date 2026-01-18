const express = require('express');
const Received = require('../models/Received');
const Material = require('../models/Material');
const User = require('../models/User');
const NotificationPreferences = require('../models/NotificationPreferences');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

const router = express.Router();

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const receivedCreateSchema = z.object({
  materialName: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  notes: z.string().optional(),
  date: z.any().optional()
});

const receivedUpdateSchema = receivedCreateSchema.partial();

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

// Get all received records for the company/site
router.get('/', authenticateToken, requireActiveSite, async (req, res, next) => {
  try {
    const query = { company: req.user.company, site: req.user.site };
    const records = await Received.find(query).sort({ date: -1 });
    return res.json({ records });
  } catch (err) {
    return next(err);
  }
});

// Create a new received record
router.post('/', authenticateToken, requireActiveSite, validate(receivedCreateSchema), async (req, res, next) => {
  try {
    const { materialName, quantity, notes, date } = req.data;

    // Validate material exists
    const material = await Material.findOne({
      name: materialName,
      company: req.user.company,
      site: req.user.site
    });
    if (!material) {
      return res.status(400).json({ message: 'Material not found in database. Create it in Add Material first.' });
    }

    const record = await Received.create({
      materialName,
      quantity,
      notes,
      date: date || new Date(),
      company: req.user.company,
      site: req.user.site,
      createdBy: req.user.id
    });

    // Update material quantity
    const prevQuantity = material.quantity || 0;
    material.quantity = prevQuantity + Number(quantity);
    await material.save();
    await notifyLowStockIfNeeded({
      material,
      prevQuantity,
      triggeredBy: req.user.id
    });

    return res.status(201).json({ record });
  } catch (err) {
    return next(err);
  }
});

// Update a record
router.put(
  '/:id',
  authenticateToken,
  requireActiveSite,
  validate(idParamsSchema, { source: 'params' }),
  validate(receivedUpdateSchema),
  async (req, res, next) => {
  try {
    const { materialName, quantity, notes, date } = req.data;
    const baseFilter = { _id: req.params.id, company: req.user.company, site: req.user.site };
    const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, createdBy: req.user.id };

    const oldRecord = await Received.findOne(filter);
    if (!oldRecord) return res.status(404).json({ message: 'Record not found' });

    // Handle quantity change in Material
    if (quantity !== undefined) {
      const material = await Material.findOne({
        name: oldRecord.materialName,
        company: req.user.company,
        site: req.user.site
      });
      if (material) {
        const prevQuantity = material.quantity || 0;
        material.quantity = prevQuantity - oldRecord.quantity + Number(quantity);
        await material.save();
        await notifyLowStockIfNeeded({
          material,
          prevQuantity,
          triggeredBy: req.user.id
        });
      }
    }

    const updated = await Received.findOneAndUpdate(
      filter,
      { materialName, quantity, notes, date },
      { new: true }
    );

    return res.json({ record: updated });
  } catch (err) {
    return next(err);
  }
});

// Delete a record
router.delete('/:id', authenticateToken, requireActiveSite, validate(idParamsSchema, { source: 'params' }), async (req, res, next) => {
  try {
    const baseFilter = { _id: req.params.id, company: req.user.company, site: req.user.site };
    const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, createdBy: req.user.id };

    const record = await Received.findOne(filter);
    if (!record) return res.status(404).json({ message: 'Record not found' });

    // Revert quantity in Material
    const material = await Material.findOne({
      name: record.materialName,
      company: req.user.company,
      site: req.user.site
    });
    if (material) {
      const prevQuantity = material.quantity || 0;
      material.quantity = prevQuantity - record.quantity;
      await material.save();
      await notifyLowStockIfNeeded({
        material,
        prevQuantity,
        triggeredBy: req.user.id
      });
    }

    await Received.deleteOne({ _id: record._id });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

