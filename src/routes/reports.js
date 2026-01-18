const express = require('express');
const DailyReport = require('../models/DailyReport');
const Panel = require('../models/Panel');
const Material = require('../models/Material');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

const router = express.Router();

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const dailyCreateSchema = z.object({
  date: z.string().optional(),
  summary: z.string().optional(),
  tasks: z.any().optional(),
  status: z.any().optional(),
  materialId: z.string().min(1),
  quantity: z.union([z.number(), z.string()]).optional(),
  location: z.string().optional(),
  panel: z.string().optional(),
  circuit: z.string().optional(),
  notes: z.string().optional()
});

const dailyUpdateSchema = z.object({
  date: z.string().optional(),
  summary: z.string().optional(),
  tasks: z.any().optional(),
  status: z.any().optional(),
  materialId: z.string().min(1).optional(),
  quantity: z.union([z.number(), z.string()]).optional(),
  location: z.string().optional(),
  panel: z.string().optional(),
  circuit: z.string().optional(),
  notes: z.string().optional()
});

router.get('/daily', authenticateToken, requireActiveSite, async (req, res, next) => {
  try {
    const query =
      req.user.role === 'admin'
        ? { company: req.user.company, site: req.user.site }
        : { createdBy: req.user.id, company: req.user.company, site: req.user.site };
    const reports = await DailyReport.find(query).sort({ date: -1 });
    return res.json({ reports });
  } catch (err) {
    return next(err);
  }
});

router.post('/daily', authenticateToken, requireActiveSite, validate(dailyCreateSchema), async (req, res, next) => {
  try {
    const { date, summary, tasks, status, materialId, quantity, location, panel, circuit, notes } = req.data;

    const material = await Material.findOne({ _id: materialId, company: req.user.company, site: req.user.site });
    if (!material) {
      return res.status(400).json({ message: 'Material must exist' });
    }

    if (panel || circuit) {
      const foundPanel = await Panel.findOne({
        name: panel,
        circuit,
        company: req.user.company,
        site: req.user.site
      });
      if (!foundPanel) {
        return res.status(400).json({ message: 'Panel and circuit must exist' });
      }
    }

    const report = await DailyReport.create({
      date: date ? new Date(date) : new Date(),
      summary: summary || material.name || '',
      tasks,
      status,
      materialId,
      materialName: material.name,
      quantity,
      location,
      panel,
      circuit,
      notes,
      company: req.user.company,
      site: req.user.site,
      createdBy: req.user.id
    });
    return res.status(201).json({ report });
  } catch (err) {
    return next(err);
  }
});

router.put(
  '/daily/:id',
  authenticateToken,
  requireActiveSite,
  validate(idParamsSchema, { source: 'params' }),
  validate(dailyUpdateSchema),
  async (req, res, next) => {
  try {
    const updates = req.data;

    if (updates.materialId) {
      const material = await Material.findOne({
        _id: updates.materialId,
        company: req.user.company,
        site: req.user.site
      });
      if (!material) {
        return res.status(400).json({ message: 'Material must exist' });
      }
      updates.materialName = material.name;
      if (!updates.summary) {
        updates.summary = material.name;
      }
    }

    if (updates.panel || updates.circuit) {
      const existing = await Panel.findOne({
        name: updates.panel,
        circuit: updates.circuit,
        company: req.user.company,
        site: req.user.site
      });
      if (!existing) {
        return res.status(400).json({ message: 'Panel and circuit must exist' });
      }
    }

    const baseFilter = { _id: req.params.id, company: req.user.company, site: req.user.site };
    const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, createdBy: req.user.id };
    const report = await DailyReport.findOneAndUpdate(filter, updates, { new: true });
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }
    return res.json({ report });
  } catch (err) {
    return next(err);
  }
});

router.delete('/daily/:id', authenticateToken, requireActiveSite, validate(idParamsSchema, { source: 'params' }), async (req, res, next) => {
  try {
    const baseFilter = { _id: req.params.id, company: req.user.company, site: req.user.site };
    const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, createdBy: req.user.id };
    const deleted = await DailyReport.findOneAndDelete(filter);
    if (!deleted) {
      return res.status(404).json({ message: 'Report not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

