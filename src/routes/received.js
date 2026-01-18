const express = require('express');
const Received = require('../models/Received');
const Material = require('../models/Material');
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
    material.quantity = (material.quantity || 0) + Number(quantity);
    await material.save();

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
        material.quantity = (material.quantity || 0) - oldRecord.quantity + Number(quantity);
        await material.save();
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
      material.quantity = (material.quantity || 0) - record.quantity;
      await material.save();
    }

    await Received.deleteOne({ _id: record._id });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

