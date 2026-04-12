const express = require('express');
const Material = require('../models/Material');
const Task = require('../models/Task');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

const router = express.Router();

const querySchema = z.object({
  q: z.string().optional().default(''),
  limit: z.union([z.string(), z.number()]).optional()
});

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get(
  '/',
  authenticateToken,
  requireActiveSite,
  validate(querySchema, { source: 'query' }),
  async (req, res) => {
    const raw = (req.data.q || '').trim();
    if (raw.length < 2) {
      return res.json({ query: raw, results: [] });
    }

    const perTypeLimit = Math.min(
      15,
      Math.max(5, parseInt(String(req.query.limit || '10'), 10) || 10)
    );
    const regex = new RegExp(escapeRegex(raw), 'i');
    const { company, site, role, id: userId } = req.user;
    const results = [];

    const materials = await Material.find({ company, site, name: regex })
      .limit(perTypeLimit)
      .select('name')
      .lean();

    for (const m of materials) {
      results.push({
        type: 'material',
        id: String(m._id),
        title: m.name,
        subtitle: 'Material',
        route: 'Inventory'
      });
    }

    const taskQuery = { site, title: regex };
    if (role !== 'admin') {
      const employee = await Employee.findOne({ user: userId });
      if (employee) {
        taskQuery.assignedTo = employee._id;
      } else {
        taskQuery._id = { $in: [] };
      }
    }

    const tasks = await Task.find(taskQuery)
      .limit(perTypeLimit)
      .select('title status')
      .lean();

    for (const t of tasks) {
      results.push({
        type: 'task',
        id: String(t._id),
        title: t.title,
        subtitle: `Task · ${t.status}`,
        route: 'Task Detail',
        params: { taskId: String(t._id) }
      });
    }

    if (role === 'admin') {
      const users = await User.find({
        company,
        $or: [{ name: regex }, { email: regex }]
      })
        .limit(perTypeLimit)
        .select('name email role')
        .lean();

      for (const u of users) {
        results.push({
          type: 'user',
          id: String(u._id),
          title: u.name,
          subtitle: `${u.email} · ${u.role}`,
          route: 'Employee'
        });
      }
    }

    res.json({ query: raw, results });
  }
);

module.exports = router;
