const express = require('express');
const DailyReport = require('../models/DailyReport');
const Panel = require('../models/Panel');
const Material = require('../models/Material');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');
const { parsePageLimit } = require('../utils/pagination');
const { idempotencyGet, idempotencySet } = require('../utils/idempotency');

const IDEMPOTENCY_REPORTS_DAILY_POST = 'POST /api/reports/daily';

const router = express.Router();

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** UTC calendar day bounds (matches client `new Date(d).toISOString().slice(0, 10)` bucketing). */
function utcDayRange(isoYmd) {
  const start = new Date(`${isoYmd}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function applyDailyReportDateFilter(query, req) {
  const dateParam = req.query.date;
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;
  if (dateParam && YMD.test(String(dateParam))) {
    const { start, end } = utcDayRange(String(dateParam));
    query.date = { $gte: start, $lt: end };
  } else if (startDate && endDate && YMD.test(String(startDate)) && YMD.test(String(endDate))) {
    const { start } = utcDayRange(String(startDate));
    const { end } = utcDayRange(String(endDate));
    query.date = { $gte: start, $lt: end };
  }
}

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

router.get('/daily', authenticateToken, requireActiveSite, async (req, res) => {
  const query =
    req.user.role === 'admin'
      ? { company: req.user.company, site: req.user.site }
      : { createdBy: req.user.id, company: req.user.company, site: req.user.site };
  applyDailyReportDateFilter(query, req);
  const { page, limit, skip } = parsePageLimit(req.query, { defaultLimit: 100, maxLimit: 10000 });
  const [reports, total] = await Promise.all([
    DailyReport.find(query).sort({ date: -1 }).skip(skip).limit(limit).lean(),
    DailyReport.countDocuments(query)
  ]);
  return res.json({
    reports,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 0 }
  });
});

router.post('/daily', authenticateToken, requireActiveSite, validate(dailyCreateSchema), async (req, res) => {
  const cached = await idempotencyGet(req, IDEMPOTENCY_REPORTS_DAILY_POST);
  if (cached) {
    return res.status(cached.statusCode).json(cached.body);
  }

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

  const reportDate = date ? new Date(date) : new Date();
  if (Number.isNaN(reportDate.getTime())) {
    return res.status(400).json({ message: 'Invalid date' });
  }
  const dayStr = reportDate.toISOString().substring(0, 10);
  const { start: dayStart, end: dayEnd } = utcDayRange(dayStr);
  const dupFilter = {
    company: req.user.company,
    site: req.user.site,
    date: { $gte: dayStart, $lt: dayEnd },
    materialName: material.name,
    location: location || '',
    panel: panel || '',
    circuit: circuit || ''
  };
  if (req.user.role !== 'admin') {
    dupFilter.createdBy = req.user.id;
  }
  const duplicate = await DailyReport.findOne(dupFilter).lean();
  if (duplicate) {
    return res.status(400).json({
      message: 'This exact entry (Material, Location, Panel, Circuit) already exists for this date'
    });
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
  const body = { report };
  await idempotencySet(req, IDEMPOTENCY_REPORTS_DAILY_POST, 201, body);
  return res.status(201).json(body);
});

router.put(
  '/daily/:id',
  authenticateToken,
  requireActiveSite,
  validate(idParamsSchema, { source: 'params' }),
  validate(dailyUpdateSchema),
  async (req, res) => {
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
    const panelRow = await Panel.findOne({
      name: updates.panel,
      circuit: updates.circuit,
      company: req.user.company,
      site: req.user.site
    });
    if (!panelRow) {
      return res.status(400).json({ message: 'Panel and circuit must exist' });
    }
  }

  const baseFilter = { _id: req.params.id, company: req.user.company, site: req.user.site };
  const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, createdBy: req.user.id };
  const existing = await DailyReport.findOne(filter).lean();
  if (!existing) {
    return res.status(404).json({ message: 'Report not found' });
  }

  const mergedDate = updates.date !== undefined ? new Date(updates.date) : new Date(existing.date);
  if (Number.isNaN(mergedDate.getTime())) {
    return res.status(400).json({ message: 'Invalid date' });
  }
  const dayStr = mergedDate.toISOString().substring(0, 10);
  const { start: dayStart, end: dayEnd } = utcDayRange(dayStr);
  const mergedMaterialName =
    updates.materialName !== undefined ? updates.materialName : existing.materialName;
  const mergedLocation = updates.location !== undefined ? updates.location : existing.location;
  const mergedPanel = updates.panel !== undefined ? updates.panel : existing.panel;
  const mergedCircuit = updates.circuit !== undefined ? updates.circuit : existing.circuit;

  const dupFilter = {
    company: req.user.company,
    site: req.user.site,
    date: { $gte: dayStart, $lt: dayEnd },
    materialName: mergedMaterialName,
    location: mergedLocation || '',
    panel: mergedPanel || '',
    circuit: mergedCircuit || '',
    _id: { $ne: existing._id }
  };
  if (req.user.role !== 'admin') {
    dupFilter.createdBy = req.user.id;
  }
  const duplicate = await DailyReport.findOne(dupFilter).lean();
  if (duplicate) {
    return res.status(400).json({
      message: 'This exact entry (Material, Location, Panel, Circuit) already exists for this date'
    });
  }

  const report = await DailyReport.findOneAndUpdate(filter, updates, { new: true });
  return res.json({ report });
});

router.delete('/daily/:id', authenticateToken, requireActiveSite, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  const baseFilter = { _id: req.params.id, company: req.user.company, site: req.user.site };
  const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, createdBy: req.user.id };
  const deleted = await DailyReport.findOneAndDelete(filter);
  if (!deleted) {
    return res.status(404).json({ message: 'Report not found' });
  }
  return res.json({ success: true });
});

module.exports = router;
