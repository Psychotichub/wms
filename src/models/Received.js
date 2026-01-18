const mongoose = require('mongoose');

const ReceivedSchema = new mongoose.Schema(
  {
    materialName: { type: String, required: true },
    quantity: { type: Number, required: true },
    notes: { type: String },
    date: { type: Date, default: Date.now },
    company: { type: String, required: true },
    site: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// Query optimization for date- and scope-based lookups
ReceivedSchema.index({ company: 1, site: 1, date: -1 });
ReceivedSchema.index({ date: -1 });

module.exports = mongoose.model('Received', ReceivedSchema);

