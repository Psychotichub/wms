const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const User = require('../models/User');

const authenticateToken = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = header.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const account = await User.findById(decoded.id).select('isDeleted');
    if (!account || account.isDeleted) {
      return res.status(401).json({ message: 'Account deactivated' });
    }
    req.user = decoded;
    return next();
  } catch (err) {
    const log = req.log || logger;
    log.warn({ errName: err.name, path: req.path }, 'JWT verification failed');
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

const requireActiveSite = (req, res, next) => {
  if (!req.user || !req.user.site) {
    return res.status(400).json({ message: 'Active site is required. Set a site in settings first.' });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireActiveSite
};

