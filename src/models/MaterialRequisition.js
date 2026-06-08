const mongoose = require('mongoose');

const requisitionItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0.01 },
  unit: { type: String, default: 'pcs', trim: true }
}, { _id: false });

const statusHistoryEntrySchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['requested', 'approved', 'rejected', 'dispatched', 'delivered'],
    required: true
  },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  changedAt: { type: Date, default: Date.now },
  note: { type: String, trim: true, default: '' }
}, { _id: false });

const materialRequisitionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  items: {
    type: [requisitionItemSchema],
    validate: {
      validator: (v) => Array.isArray(v) && v.length > 0,
      message: 'At least one item is required'
    }
  },
  status: {
    type: String,
    enum: ['requested', 'approved', 'rejected', 'dispatched', 'delivered'],
    default: 'requested'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewNote: {
    type: String,
    trim: true,
    default: ''
  },
  reviewedAt: { type: Date },
  dispatchedAt: { type: Date },
  deliveredAt: { type: Date },
  site: {
    type: String,
    required: true
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  statusHistory: [statusHistoryEntrySchema]
}, {
  timestamps: true
});

// Indexes for efficient queries
materialRequisitionSchema.index({ requestedBy: 1, status: 1 });
materialRequisitionSchema.index({ site: 1, status: 1 });
materialRequisitionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MaterialRequisition', materialRequisitionSchema);
