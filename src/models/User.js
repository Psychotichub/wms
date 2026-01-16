const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    company: { type: String, required: true },
    site: { type: String, required: true },
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
    ]
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

module.exports = mongoose.model('User', UserSchema);

