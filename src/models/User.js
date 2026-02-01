const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    company: { type: String, required: true },
    site: { type: String, default: null },
    sites: { type: [String], default: [] },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    // Device binding for security
    boundDevices: [{
      deviceId: { type: String, required: true },
      deviceName: { type: String },
      deviceType: { type: String, enum: ['ios', 'android', 'web'] },
      lastUsed: { type: Date, default: Date.now },
      isActive: { type: Boolean, default: true }
    }],
    // Security settings
    requireDeviceBinding: { type: Boolean, default: false },
    maxBoundDevices: { type: Number, default: 3 },

    // Refresh token rotation (store hashed jti so tokens can be revoked/rotated)
    refreshTokens: [
      {
        jtiHash: { type: String, required: true },
        deviceId: { type: String },
        deviceType: { type: String, enum: ['ios', 'android', 'web'] },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true }
      }
    ],
    // Email verification fields
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, default: null },
    emailVerificationTokenExpiry: { type: Date, default: null },
    emailVerificationCode: { type: String, default: null },
    emailVerificationCodeExpiry: { type: Date, default: null },
    // Track if user was created by admin (to prevent cleanup from deleting them)
    createdByAdmin: { type: Boolean, default: false }
  },
  { timestamps: true }
);

UserSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  return next();
});

UserSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Query optimization for common filters
UserSchema.index({ company: 1, site: 1 });

const User = mongoose.model('User', UserSchema);

// Drop old phoneNumber index if it exists (from previous schema version)
// This prevents E11000 duplicate key errors when multiple users have null phoneNumber
(async () => {
  try {
    const indexes = await User.collection.indexes();
    const phoneNumberIndex = indexes.find(
      (idx) => idx.key && idx.key.phoneNumber === 1
    );
    if (phoneNumberIndex) {
      await User.collection.dropIndex(phoneNumberIndex.name);
      console.log('Dropped obsolete phoneNumber index from users collection');
    }
  } catch (err) {
    // Ignore if collection not ready, index missing, or already dropped
    if (err.code !== 27 && err.code !== 85) {
      console.warn('Could not drop phoneNumber index:', err.message);
    }
  }
})();

module.exports = User;

