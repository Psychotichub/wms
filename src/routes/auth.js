const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { createAccessToken } = require('../utils/tokens');
const { sendVerificationEmail, sendResendVerificationEmail } = require('../utils/email');

const { validateDeviceBinding } = require('./devices');
const { validate, z } = require('../middleware/validation');
const { cleanupUnverifiedUsers } = require('../utils/cleanupUnverifiedUsers');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Reusable password validation schema
const passwordSchema = z.string()
  .min(6, 'Password must be at least 6 characters')
  .refine((val) => /[A-Z]/.test(val), {
    message: 'Password must contain at least one capital letter'
  })
  .refine((val) => /[a-z]/.test(val), {
    message: 'Password must contain at least one lowercase letter'
  })
  .refine((val) => /[0-9]/.test(val), {
    message: 'Password must contain at least one number'
  })
  .refine((val) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(val), {
    message: 'Password must contain at least one special character'
  });

const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: passwordSchema,
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

const verifyEmailSchema = z.object({
  token: z.string().min(1).optional(),
  code: z.string().min(6).max(6).optional()
}).refine((data) => data.token || data.code, {
  message: 'Either token or code must be provided'
});

const resendVerificationSchema = z.object({
  email: z.string().email()
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

/**
 * Generate a unique email verification token
 * @returns {String} - Random token string
 */
const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Generate a 6-digit verification code
 * @returns {String} - 6-digit numeric code
 */
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Build verification URL for email verification
 * @param {String} token - Verification token
 * @returns {String} - Full verification URL
 */
const buildVerificationUrl = (token) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:19006';
  return `${frontendUrl}/verify-email?token=${token}`;
};

router.post('/signup', validate(signupSchema), async (req, res, next) => {
  try {
    const { name, email, password, company, site, adminCode } = req.data; // use validated data
    const normalizedEmail = String(email || '').trim().toLowerCase();
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

    // Check if company or site already has an admin - if so, ignore site assignment for new admin
    let finalSite = resolvedSite || null;
    let finalSites = resolvedSite ? [resolvedSite] : [];
    
    if (isAdminMatch) {
      // Check if company already has an admin (regardless of site)
      const existingCompanyAdmin = await User.findOne({ 
        role: 'admin', 
        company: company 
      });
      
      // Also check if the specific site already has an admin
      const existingSiteAdmin = resolvedSite ? await User.findOne({ 
        role: 'admin', 
        site: resolvedSite,
        company: company 
      }) : null;
      
      if (existingCompanyAdmin || existingSiteAdmin) {
        // Company or site already has an admin, ignore site assignment
        finalSite = null;
        finalSites = [];
      }
    }

    // Generate email verification token and code
    // Get expiry hours from environment (default: 0.25 hours = 15 minutes)
    const expiryHours = parseFloat(process.env.VERIFICATION_EXPIRY_HOURS || '0.25');
    const expiryTime = expiryHours * 60 * 60 * 1000; // Convert to milliseconds
    
    const verificationToken = generateVerificationToken();
    const verificationCode = generateVerificationCode();
    const verificationTokenExpiry = new Date(Date.now() + expiryTime);
    const verificationCodeExpiry = new Date(Date.now() + expiryTime);

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      role,
      company,
      site: finalSite,
      sites: finalSites,
      isEmailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiry: verificationTokenExpiry,
      emailVerificationCode: verificationCode,
      emailVerificationCodeExpiry: verificationCodeExpiry
    });
    
    // Send verification email (don't block signup if email fails)
    try {
      const verificationUrl = buildVerificationUrl(verificationToken);
      await sendVerificationEmail({
        email: normalizedEmail,
        name: name,
        verificationToken: verificationToken,
        verificationUrl: verificationUrl,
        verificationCode: verificationCode
      });
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Don't fail signup if email fails - user can request resend later
    }
    
    // Don't return tokens on signup - user must verify email first
    // Tokens will be returned after email verification
    const responsePayload = {
      message: 'Account created successfully. Please verify your email to continue.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: user.company,
        site: user.site,
        sites: user.sites || [],
        isEmailVerified: false // Always false on signup
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
          // Generate email verification token and code
          const expiryHours = parseFloat(process.env.VERIFICATION_EXPIRY_HOURS || '0.25');
          const expiryTime = expiryHours * 60 * 60 * 1000;
          
          const verificationToken = generateVerificationToken();
          const verificationCode = generateVerificationCode();
          const verificationTokenExpiry = new Date(Date.now() + expiryTime);
          const verificationCodeExpiry = new Date(Date.now() + expiryTime);
          
          const user = await User.create({
            name,
            email: normalizedEmail,
            password,
            role,
            company,
            site: resolvedSite || null,
            sites: resolvedSite ? [resolvedSite] : [],
            isEmailVerified: false,
            emailVerificationToken: verificationToken,
            emailVerificationTokenExpiry: verificationTokenExpiry,
            emailVerificationCode: verificationCode,
            emailVerificationCodeExpiry: verificationCodeExpiry
          });
          
          // Send verification email
          try {
            const verificationUrl = buildVerificationUrl(verificationToken);
            await sendVerificationEmail({
              email: normalizedEmail,
              name: name,
              verificationToken: verificationToken,
              verificationUrl: verificationUrl,
              verificationCode: verificationCode
            });
          } catch (emailError) {
            console.error('Failed to send verification email:', emailError);
          }
          
          // Don't return tokens - user must verify email first
          return res.status(201).json({
            message: 'Account created successfully. Please verify your email to continue.',
            user: {
              id: user._id,
              name: user.name,
              email: user.email,
              role: user.role,
              company: user.company,
              site: user.site,
              sites: user.sites || [],
              isEmailVerified: false
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
    
    // Check if email is verified before allowing login
    if (!user.isEmailVerified) {
      return res.status(403).json({ 
        message: 'Please verify your email before logging in. Check your inbox for the verification link and code.',
        requiresVerification: true
      });
    }
    
    // Case-insensitive company comparison
    if (company && user.company && company.toLowerCase().trim() !== user.company.toLowerCase().trim()) {
      return res.status(403).json({ message: 'Company mismatch' });
    }
    // Case-insensitive site comparison
    if (site && user.site && site.toLowerCase().trim() !== user.site.toLowerCase().trim()) {
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
        sites: user.sites || [],
        isEmailVerified: user.isEmailVerified || false
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
        sites: user.sites || [],
        isEmailVerified: user.isEmailVerified || false
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

/**
 * POST /api/auth/verify-email
 * Verify user email with token or code
 */
router.post('/verify-email', validate(verifyEmailSchema), async (req, res, next) => {
  try {
    const { token, code } = req.data;
    
    let user;
    
    // Verify with token if provided
    if (token) {
      user = await User.findOne({
        emailVerificationToken: token,
        emailVerificationTokenExpiry: { $gt: new Date() } // Token not expired
      });
      
      if (!user) {
        return res.status(400).json({ 
          message: 'Invalid or expired verification token' 
        });
      }
    } 
    // Verify with code if provided
    else if (code) {
      user = await User.findOne({
        emailVerificationCode: code,
        emailVerificationCodeExpiry: { $gt: new Date() } // Code not expired
      });
      
      if (!user) {
        return res.status(400).json({ 
          message: 'Invalid or expired verification code' 
        });
      }
    } else {
      return res.status(400).json({ 
        message: 'Either token or code must be provided' 
      });
    }
    
    // Mark email as verified and clear both token and code
    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiry = null;
    user.emailVerificationCode = null;
    user.emailVerificationCodeExpiry = null;
    await user.save();
    
    // Generate tokens for authenticated session
    const accessToken = createAccessToken(user);
    const { token: refreshToken, record } = createRefreshToken(user, null, 'web');
    user.refreshTokens = (user.refreshTokens || []).concat(record).slice(-10);
    await user.save();
    
    return res.json({ 
      message: 'Email verified successfully',
      token: accessToken,
      refreshToken: refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: user.company,
        site: user.site,
        sites: user.sites || [],
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/auth/resend-verification
 * Resend verification email to user
 */
router.post('/resend-verification', validate(resendVerificationSchema), async (req, res, next) => {
  try {
    const { email } = req.data;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    
    // Find user by email
    const user = await User.findOne({ email: normalizedEmail });
    
    if (!user) {
      // Don't reveal if email exists or not (security best practice)
      return res.json({ 
        message: 'If the email exists and is not verified, a verification email has been sent.' 
      });
    }
    
    // If already verified, don't send email
    if (user.isEmailVerified) {
      return res.json({ 
        message: 'Email is already verified' 
      });
    }
    
    // Generate new verification token and code
    const expiryHours = parseFloat(process.env.VERIFICATION_EXPIRY_HOURS || '0.25');
    const expiryTime = expiryHours * 60 * 60 * 1000; // Convert to milliseconds
    
    const verificationToken = generateVerificationToken();
    const verificationCode = generateVerificationCode();
    const verificationTokenExpiry = new Date(Date.now() + expiryTime);
    const verificationCodeExpiry = new Date(Date.now() + expiryTime);
    
    // Update user with new token and code
    user.emailVerificationToken = verificationToken;
    user.emailVerificationTokenExpiry = verificationTokenExpiry;
    user.emailVerificationCode = verificationCode;
    user.emailVerificationCodeExpiry = verificationCodeExpiry;
    await user.save();
    
    // Send verification email
    try {
      const verificationUrl = buildVerificationUrl(verificationToken);
      await sendResendVerificationEmail({
        email: normalizedEmail,
        name: user.name,
        verificationToken: verificationToken,
        verificationUrl: verificationUrl,
        verificationCode: verificationCode
      });
      
      return res.json({ 
        message: 'Verification email sent successfully' 
      });
    } catch (emailError) {
      console.error('Failed to send resend verification email:', emailError);
      return res.status(500).json({ 
        message: 'Failed to send verification email. Please try again later.' 
      });
    }
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

// POST /api/auth/cleanup-unverified - Manually trigger cleanup of unverified users (Admin only)
router.post('/cleanup-unverified', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const result = await cleanupUnverifiedUsers();
    res.json({
      success: true,
      message: result.message,
      result: {
        checked: result.checked,
        deleted: result.deleted,
        emails: result.emails
      }
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

