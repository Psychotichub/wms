const jwt = require('jsonwebtoken');

function createTestToken(overrides = {}) {
  const payload = {
    id: overrides.id || '507f1f77bcf86cd799439011',
    email: overrides.email || 'test@example.com',
    role: overrides.role || 'admin',
    company: overrides.company || 'TestCo',
    site: overrides.site || 'TestSite',
    ...overrides,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

module.exports = { createTestToken };
