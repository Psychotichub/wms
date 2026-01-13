const mongoose = require('mongoose');

const MaterialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    quantity: { type: Number, default: 0 },
    unit: { type: String, enum: ['pcs', 'm'], default: 'pcs' },
    materialPrice: { type: Number, default: 0 },
    labourPrice: { type: Number, default: 0 },
    price: { type: Number, default: 0 }, // total = materialPrice + labourPrice
    location: { type: String, default: '' },
    panel: { type: String, default: '' },
    circuit: { type: String, default: '' },
    receivedAt: { type: Date, default: Date.now },
    company: { type: String, required: true },
    site: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// Ensure uniqueness per company/site
MaterialSchema.index({ name: 1, company: 1, site: 1 }, { unique: true });

module.exports = mongoose.model('Material', MaterialSchema);

