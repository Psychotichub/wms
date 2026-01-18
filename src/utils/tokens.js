const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set');
}

const createAccessToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role, company: user.company, site: user.site },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );

module.exports = {
  createAccessToken
};
