const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    trim: true
  },
  coordinates: [{
    type: [Number], // [longitude, latitude]
    required: true
  }],
  type: {
    type: String,
    enum: ['polygon', 'circle'],
    default: 'polygon'
  },
  radius: {
    type: Number, // For circle type locations
  },
  center: {
    type: [Number], // [longitude, latitude] for circle center
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  organizationId: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Location', locationSchema);
