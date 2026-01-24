const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = header.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    // Log the actual error for debugging (but don't expose sensitive details to client)
    console.error('JWT verification failed:', {
      name: err.name,
      message: err.message,
      path: req.path,
      // Only log in development
      ...(process.env.NODE_ENV !== 'production' && { fullError: err.toString() })
    });
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

