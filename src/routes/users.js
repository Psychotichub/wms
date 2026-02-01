const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { authenticateToken, requireAdmin, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');
const { sendVerificationEmail } = require('../utils/email');

const router = express.Router();

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const userCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string()
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
    }),
  role: z.string().optional(),
  company: z.string().optional()
});

const passwordUpdateSchema = z.object({
  password: z.string().min(1)
});

router.get('/', authenticateToken, requireActiveSite, requireAdmin, async (req, res, next) => {
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
  requireActiveSite,
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

router.delete('/:id', authenticateToken, requireActiveSite, requireAdmin, validate(idParamsSchema, { source: 'params' }), async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, company: req.user.company });
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // Find and unlink any employees associated with this user account
    await Employee.updateMany(
      { user: req.params.id },
      { $unset: { user: '' } }
    );
    
    // Delete the user account
    await User.findByIdAndDelete(req.params.id);
    
    return res.json({ message: 'User deleted' });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticateToken, requireActiveSite, requireAdmin, validate(userCreateSchema), async (req, res, next) => {
  try {
    const { name, email, password, role, company } = req.data;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const site = req.user.site; // site locked to admin's site
    if (!site) {
      return res.status(400).json({ message: 'Active site is required. Set a site in settings first.' });
    }

    const chosenCompany = company || req.user.company;
    if (!chosenCompany) {
      return res.status(400).json({ message: 'Company is required' });
    }

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    
    const userRole = role || 'user';
    
    // Generate email verification token and code for employee
    // Employee must verify email before they can login
    const expiryHours = parseFloat(process.env.VERIFICATION_EXPIRY_HOURS || '0.25');
    const expiryTime = expiryHours * 60 * 60 * 1000; // Convert to milliseconds
    
    const generateVerificationToken = () => {
      return crypto.randomBytes(32).toString('hex');
    };
    
    const generateVerificationCode = () => {
      return Math.floor(100000 + Math.random() * 900000).toString();
    };
    
    const buildVerificationUrl = (token) => {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return `${frontendUrl}/verify-email?token=${token}`;
    };
    
    const verificationToken = generateVerificationToken();
    const verificationCode = generateVerificationCode();
    const verificationTokenExpiry = new Date(Date.now() + expiryTime);
    const verificationCodeExpiry = new Date(Date.now() + expiryTime);
    
    // Admins can create other admin accounts without restrictions
    // The requireAdmin middleware ensures only admins can access this route
    // Set createdByAdmin flag so cleanup doesn't delete these users
    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      role: userRole,
      company: chosenCompany,
      site: site,
      isEmailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiry: verificationTokenExpiry,
      emailVerificationCode: verificationCode,
      emailVerificationCodeExpiry: verificationCodeExpiry,
      createdByAdmin: true // Flag to prevent cleanup from deleting admin-created users
    });
    
    // Send verification email to employee
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
      // Don't fail user creation if email fails - user can request resend later
    }
    return res.status(201).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: user.company,
        site: user.site
      }
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

