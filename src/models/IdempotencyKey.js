const mongoose = require('mongoose');

const IdempotencyKeySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    key: { type: String, required: true },
    routeKey: { type: String, required: true },
    statusCode: { type: Number, required: true },
    responseBody: { type: String, required: true }
  },
  { timestamps: true }
);

IdempotencyKeySchema.index({ userId: 1, key: 1, routeKey: 1 }, { unique: true });
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 48 });

module.exports = mongoose.model('IdempotencyKey', IdempotencyKeySchema);
