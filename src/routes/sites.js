const express = require('express');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');
const { createAccessToken } = require('../utils/tokens');

const router = express.Router();

const siteSchema = z.object({
  site: z.string().min(1)
});

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('site sites role');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const sites = Array.isArray(user.sites) && user.sites.length
      ? user.sites
      : (user.site ? [user.site] : []);
    return res.json({ sites, activeSite: user.site });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticateToken, requireAdmin, validate(siteSchema), async (req, res, next) => {
  try {
    const { site } = req.data;
    const normalizedSite = String(site).trim();
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const currentSites = Array.isArray(user.sites) ? user.sites : [];
    const sitesSet = new Set(currentSites.filter(Boolean));
    sitesSet.add(normalizedSite);
    user.sites = Array.from(sitesSet);
    if (!user.site) {
      user.site = normalizedSite;
    }
    await user.save();
    const token = createAccessToken(user);
    return res.status(201).json({
      token,
      sites: user.sites,
      activeSite: user.site,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: user.company,
        site: user.site,
        sites: user.sites || []
      }
    });
  } catch (err) {
    return next(err);
  }
});

router.put('/active', authenticateToken, requireAdmin, validate(siteSchema), async (req, res, next) => {
  try {
    const { site } = req.data;
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const sites = Array.isArray(user.sites) ? user.sites : [];
    if (!sites.includes(site)) {
      return res.status(400).json({ message: 'Site is not in your site list' });
    }
    user.site = site;
    await user.save();
    const token = createAccessToken(user);
    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: user.company,
        site: user.site,
        sites: user.sites || []
      }
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
