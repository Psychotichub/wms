const express = require('express');
const Material = require('../models/Material');
const { authenticateToken, requireActiveSite, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

router.get(
  '/materials.csv',
  authenticateToken,
  requireActiveSite,
  requireAdmin,
  async (req, res) => {
    const { company, site } = req.user;
    const materials = await Material.find({ company, site }).sort({ name: 1 }).lean();

    const header = ['name', 'quantity', 'unit', 'materialPrice', 'labourPrice', 'price', 'location', 'panel', 'circuit'];
    const lines = [header.join(',')];
    for (const m of materials) {
      lines.push(
        [
          csvEscape(m.name),
          csvEscape(m.quantity),
          csvEscape(m.unit),
          csvEscape(m.materialPrice),
          csvEscape(m.labourPrice),
          csvEscape(m.price),
          csvEscape(m.location),
          csvEscape(m.panel),
          csvEscape(m.circuit)
        ].join(',')
      );
    }

    const body = lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="materials-export.csv"');
    res.send(body);
  }
);

module.exports = router;
