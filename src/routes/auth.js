const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');



const { validateDeviceBinding } = require('./devices');
const { validate, z } = require('../middleware/validation');

const router = express.Router();

const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  company: z.string().min(1),
  site: z.string().min(1),
  adminCode: z.string().min(1).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  company: z.string().optional(),
  site: z.string().optional(),
  deviceId: z.string().optional(),
  deviceType: z.enum(['ios', 'android', 'web']).optional()
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10)
});

const logoutSchema = z.object({
  refreshToken: z.string().min(10).optional()
});

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL = process.env.REFRESH_TOKEN_TTL || '30d';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set');
}
if (!REFRESH_TOKEN_SECRET) {
  // Fail fast with a clear error instead of a confusing jsonwebtoken stack trace.
  throw new Error('REFRESH_TOKEN_SECRET is not set');
}

const hashJti = (jti) => crypto.createHash('sha256').update(jti).digest('hex');

const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  try {
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
};

const createToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role, company: user.company, site: user.site },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );

const createRefreshToken = (user, deviceId, deviceType) => {
  const jti = crypto.randomBytes(32).toString('hex');
  const token = jwt.sign(
    { id: user._id, jti, type: 'refresh', deviceId: deviceId || null, deviceType: deviceType || null },
    REFRESH_TOKEN_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL }
  );

  const decoded = jwt.decode(token);
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return {
    token,
    record: {
      jtiHash: hashJti(jti),
      deviceId,
      deviceType,
      expiresAt
    }
  };
};

router.post('/signup', validate(signupSchema), async (req, res, next) => {
  try {
    const { name, email, password, company, site, adminCode } = req.data; // use validated data
    if (!company || !site) {
      return res.status(400).json({ message: 'Company and site are required' });
    }
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    // Admin signup is only allowed when explicitly enabled via env code.
    // In production, keep ADMIN_SIGNUP_CODE unset to prevent public admin creation.
    const configuredAdminCode = process.env.ADMIN_SIGNUP_CODE;
    const role =
      configuredAdminCode && adminCode && safeEqual(adminCode, configuredAdminCode) ? 'admin' : 'user';

    const user = await User.create({ name, email, password, role, company, site });
    const token = createToken(user);
    const { token: refreshToken, record } = createRefreshToken(user, null, 'web');
    user.refreshTokens = (user.refreshTokens || []).concat(record).slice(-10);
    await user.save();
    return res.status(201).json({
      token,
      refreshToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, company: user.company, site: user.site }
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password, company, site, deviceId, deviceType } = req.data; // use validated data
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

    // Device Binding Check
    if (deviceId) {
      const bindingResult = await validateDeviceBinding(user._id, deviceId, deviceType);
      if (!bindingResult.valid) {
        return res.status(403).json({
          message: 'Device binding failed',
          reason: bindingResult.reason
        });
      }
    } else if (user.requireDeviceBinding) {
      return res.status(403).json({ message: 'Device binding required' });
    }

    const token = createToken(user);
    const { token: refreshToken, record } = createRefreshToken(user, deviceId, deviceType);
    user.refreshTokens = (user.refreshTokens || []).concat(record).slice(-10);
    await user.save();
    return res.json({
      token,
      refreshToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, company: user.company, site: user.site }
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/refresh', validate(refreshSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.data;
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
    } catch {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    if (!decoded || decoded.type !== 'refresh' || !decoded.id || !decoded.jti) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const now = new Date();
    const jtiHash = hashJti(decoded.jti);
    const tokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
    const match = tokens.find((t) => t.jtiHash === jtiHash);
    if (!match) {
      return res.status(401).json({ message: 'Refresh token revoked' });
    }
    if (match.expiresAt && match.expiresAt <= now) {
      user.refreshTokens = tokens.filter((t) => t.jtiHash !== jtiHash);
      await user.save();
      return res.status(401).json({ message: 'Refresh token expired' });
    }

    // Rotate: remove the old refresh token record and issue a new one
    user.refreshTokens = tokens.filter((t) => t.jtiHash !== jtiHash);
    const { token: newRefreshToken, record } = createRefreshToken(user, decoded.deviceId, decoded.deviceType);
    user.refreshTokens = user.refreshTokens.concat(record).slice(-10);
    await user.save();

    const token = createToken(user);
    return res.json({
      token,
      refreshToken: newRefreshToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, company: user.company, site: user.site }
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', validate(logoutSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.data;
    if (!refreshToken) {
      return res.json({ success: true });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
    } catch {
      return res.json({ success: true });
    }

    if (!decoded?.id || !decoded?.jti) {
      return res.json({ success: true });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.json({ success: true });
    }

    const jtiHash = hashJti(decoded.jti);
    user.refreshTokens = (user.refreshTokens || []).filter((t) => t.jtiHash !== jtiHash);
    await user.save();
    return res.json({ success: true });
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

