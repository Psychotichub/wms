const express = require('express');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

const router = express.Router();

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const userCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
  role: z.string().optional(),
  company: z.string().optional()
});

const passwordUpdateSchema = z.object({
  password: z.string().min(1)
});

router.get('/', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const users = await User.find({ company: req.user.company, site: req.user.site }).select('-password');
    return res.json({ users });
  } catch (err) {
    return next(err);
  }
});

router.put(
  '/:id/password',
  authenticateToken,
  requireAdmin,
  validate(idParamsSchema, { source: 'params' }),
  validate(passwordUpdateSchema),
  async (req, res, next) => {
  try {
    const { password } = req.data;

    const user = await User.findOne({ _id: req.params.id, company: req.user.company });
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.password = password;
    await user.save();

    return res.json({ message: 'Password updated successfully' });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', authenticateToken, requireAdmin, validate(idParamsSchema, { source: 'params' }), async (req, res, next) => {
  try {
    const user = await User.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ message: 'User deleted' });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticateToken, requireAdmin, validate(userCreateSchema), async (req, res, next) => {
  try {
    const { name, email, password, role, company } = req.data;
    const site = req.user.site; // site locked to admin's site

    const chosenCompany = company || req.user.company;
    if (!chosenCompany) {
      return res.status(400).json({ message: 'Company is required' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    const user = await User.create({
      name,
      email,
      password,
      role: role || 'user',
      company: chosenCompany,
      site
    });
    return res.status(201).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: user.company,
        site
      }
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

