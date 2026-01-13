const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const createToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role, company: user.company, site: user.site },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

router.post('/signup', async (req, res, next) => {
  try {
    const { name, email, password, company, site } = req.body;
    if (!company || !site) {
      return res.status(400).json({ message: 'Company and site are required' });
    }
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    const user = await User.create({ name, email, password, role: 'admin', company, site });
    const token = createToken(user);
    return res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, company: user.company, site: user.site }
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password, company, site } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (company && company !== user.company) {
      return res.status(403).json({ message: 'Company mismatch' });
    }
    if (site && site !== user.site) {
      return res.status(403).json({ message: 'Site mismatch' });
    }
    const token = createToken(user);
    return res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, company: user.company, site: user.site }
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ user });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

