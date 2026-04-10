const express = require('express');
const router = express.Router();
const IsolationTest = require('../models/IsolationTest');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

const requireAuth = [authenticateToken, requireActiveSite];

const columnSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1)
});

const rowSchema = z.object({
  id: z.string().min(1),
  cells: z.record(z.string(), z.string())
});

const panelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  columns: z.array(columnSchema),
  rows: z.array(rowSchema),
  collapsed: z.boolean().optional()
});

const savePanelsSchema = z.object({
  panels: z.array(panelSchema)
});

const singlePanelSchema = z.object({
  panel: panelSchema
});

// GET /api/isolation-tests — load all panels for this company+site
router.get('/', requireAuth, async (req, res) => {
  try {
    const { company, site } = req.user;
    const doc = await IsolationTest.findOne({ company, site }).lean();
    res.json({ panels: doc ? doc.panels : [] });
  } catch (err) {
    console.error('GET /api/isolation-tests error:', err);
    res.status(500).json({ error: 'Failed to fetch isolation tests' });
  }
});

// PUT /api/isolation-tests — bulk-save all panels (full replace)
router.put('/', requireAuth, validate(savePanelsSchema), async (req, res) => {
  try {
    const { company, site, id: userId } = req.user;
    const { panels } = req.data;

    const doc = await IsolationTest.findOneAndUpdate(
      { company, site },
      { $set: { panels, createdBy: userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ panels: doc.panels });
  } catch (err) {
    console.error('PUT /api/isolation-tests error:', err);
    res.status(500).json({ error: 'Failed to save isolation tests' });
  }
});

// POST /api/isolation-tests/panels — add a single panel
router.post('/panels', requireAuth, validate(singlePanelSchema), async (req, res) => {
  try {
    const { company, site, id: userId } = req.user;
    const { panel } = req.data;

    let doc = await IsolationTest.findOne({ company, site });

    if (!doc) {
      doc = new IsolationTest({ company, site, createdBy: userId, panels: [] });
    }

    const exists = doc.panels.some(
      (p) => p.name.toLowerCase() === panel.name.toLowerCase()
    );
    if (exists) {
      return res.status(409).json({ error: `Panel "${panel.name}" already exists` });
    }

    doc.panels.push(panel);
    await doc.save();

    res.status(201).json({ panels: doc.panels });
  } catch (err) {
    console.error('POST /api/isolation-tests/panels error:', err);
    res.status(500).json({ error: 'Failed to add panel' });
  }
});

// PUT /api/isolation-tests/panels/:panelId — update a single panel
router.put('/panels/:panelId', requireAuth, validate(singlePanelSchema), async (req, res) => {
  try {
    const { company, site } = req.user;
    const { panelId } = req.params;
    const { panel } = req.data;

    const doc = await IsolationTest.findOne({ company, site });
    if (!doc) return res.status(404).json({ error: 'No isolation test record found' });

    const idx = doc.panels.findIndex((p) => p.id === panelId);
    if (idx === -1) return res.status(404).json({ error: 'Panel not found' });

    doc.panels[idx] = panel;
    doc.markModified('panels');
    await doc.save();

    res.json({ panels: doc.panels });
  } catch (err) {
    console.error('PUT /api/isolation-tests/panels/:panelId error:', err);
    res.status(500).json({ error: 'Failed to update panel' });
  }
});

// DELETE /api/isolation-tests/panels/:panelId — delete a single panel
router.delete('/panels/:panelId', requireAuth, async (req, res) => {
  try {
    const { company, site } = req.user;
    const { panelId } = req.params;

    const doc = await IsolationTest.findOne({ company, site });
    if (!doc) return res.status(404).json({ error: 'No isolation test record found' });

    doc.panels = doc.panels.filter((p) => p.id !== panelId);
    await doc.save();

    res.json({ panels: doc.panels });
  } catch (err) {
    console.error('DELETE /api/isolation-tests/panels/:panelId error:', err);
    res.status(500).json({ error: 'Failed to delete panel' });
  }
});

module.exports = router;
