const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { createAccessToken } = require('../utils/tokens');



const { validateDeviceBinding } = require('./devices');
const { validate, z } = require('../middleware/validation');

const router = express.Router();

const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  company: z.string().min(1),
  site: z.string().min(1).optional(),
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
const appEnv = (process.env.APP_ENV || 'development').toLowerCase();

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
    const normalizedEmail = String(email || '').trim().toLowerCase();
    console.log('Signup admin code check:', {
      provided: Boolean(adminCode),
      configured: Boolean(process.env.ADMIN_SIGNUP_CODE),
      matches: Boolean(adminCode && process.env.ADMIN_SIGNUP_CODE && safeEqual(adminCode, process.env.ADMIN_SIGNUP_CODE))
    });
    if (!company) {
      return res.status(400).json({ message: 'Company is required' });
    }
    const resolvedSite = site ? String(site).trim() : '';
    
    // Check database connection
    if (mongoose.connection.readyState !== 1) {
      console.error('Database not connected. ReadyState:', mongoose.connection.readyState);
      return res.status(503).json({ message: 'Database connection unavailable. Please try again later.' });
    }
    
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    // Admin signup is only allowed when explicitly enabled via env code.
    // In production, keep ADMIN_SIGNUP_CODE unset to prevent public admin creation.
    const configuredAdminCode = process.env.ADMIN_SIGNUP_CODE;
    const isAdminMatch =
      configuredAdminCode && adminCode && safeEqual(adminCode, configuredAdminCode);
    const role = isAdminMatch ? 'admin' : 'user';

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      role,
      company,
      site: resolvedSite || null,
      sites: resolvedSite ? [resolvedSite] : []
    });
    const token = createAccessToken(user);
    const { token: refreshToken, record } = createRefreshToken(user, null, 'web');
    user.refreshTokens = (user.refreshTokens || []).concat(record).slice(-10);
    await user.save();
    const responsePayload = {
      token,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: user.company,
        site: user.site,
        sites: user.sites || []
      }
    };
    if (appEnv === 'development') {
      responsePayload.adminCodeStatus = {
        provided: Boolean(adminCode),
        configured: Boolean(configuredAdminCode),
        matches: Boolean(isAdminMatch)
      };
    }
    return res.status(201).json(responsePayload);
  } catch (err) {
    // Log detailed error for debugging
    console.error('Signup error:', {
      message: err.message,
      name: err.name,
      code: err.code,
      stack: appEnv === 'development' ? err.stack : undefined
    });
    
    // Handle specific MongoDB errors
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message).join(', ');
      return res.status(400).json({ message: `Validation error: ${messages}` });
    }
    
    if (err.code === 11000) {
      // Check if it's a duplicate email or another unique constraint
      if (err.message && err.message.includes('email')) {
        return res.status(400).json({ message: 'Email already registered' });
      }
      // Handle other duplicate key errors (like phoneNumber index)
      if (err.message && err.message.includes('phoneNumber')) {
        console.error('phoneNumber index error - this should be fixed by migration:', err.message);
        // Retry once after a brief delay to allow migration to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          const resolvedSite = site ? String(site).trim() : '';
          const user = await User.create({
            name,
            email: normalizedEmail,
            password,
            role,
            company,
            site: resolvedSite || null,
            sites: resolvedSite ? [resolvedSite] : []
          });
          const token = createAccessToken(user);
          const { token: refreshToken, record } = createRefreshToken(user, null, 'web');
          user.refreshTokens = (user.refreshTokens || []).concat(record).slice(-10);
          await user.save();
          return res.status(201).json({
            token,
            refreshToken,
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
        } catch (retryErr) {
          return res.status(500).json({ 
            message: 'Account creation failed. Please contact support if this persists.' 
          });
        }
      }
      return res.status(400).json({ message: 'A record with this information already exists' });
    }
    
    if (err.name === 'MongoServerError' || err.name === 'MongoNetworkError') {
      return res.status(503).json({ message: 'Database connection error. Please try again later.' });
    }
    
    // Generic error handler
    return next(err);
  }
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password, company, site, deviceId, deviceType } = req.data; // use validated data
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
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

    const token = createAccessToken(user);
    const { token: refreshToken, record } = createRefreshToken(user, deviceId, deviceType);
    user.refreshTokens = (user.refreshTokens || []).concat(record).slice(-10);
    await user.save();
    return res.json({
      token,
      refreshToken,
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

    const token = createAccessToken(user);
    return res.json({
      token,
      refreshToken: newRefreshToken,
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

