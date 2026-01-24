const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  dueDate: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  location: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Location'
  },
  site: {
    type: String
  },
  category: {
    type: String,
    enum: ['installation', 'maintenance', 'inspection', 'repair', 'delivery', 'other'],
    default: 'other'
  },
  estimatedHours: {
    type: Number,
    min: 0
  },
  actualHours: {
    type: Number,
    min: 0
  },
  notes: {
    type: String,
    trim: true
  },
  attachments: [{
    url: String,
    name: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  tags: [{
    type: String,
    trim: true
  }],
  relatedMaterials: [{
    material: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Material'
    },
    quantity: Number
  }],
  checklist: [{
    item: String,
    completed: { type: Boolean, default: false },
    completedAt: Date
  }],
  assignmentHistory: [{
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    transferredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee' // Employee who transferred the task (if transferred)
    },
    transferNote: {
      type: String,
      trim: true // Required note when transferring
    },
    assignedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'cancelled'],
      default: 'pending'
    }
  }]
}, {
  timestamps: true
});

// Indexes for efficient queries
taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ assignedBy: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ status: 1, priority: 1 });
taskSchema.index({ site: 1 });
taskSchema.index({ site: 1, status: 1 });

// Virtual for overdue status
taskSchema.virtual('isOverdue').get(function() {
  if (!this.dueDate || this.status === 'completed' || this.status === 'cancelled') {
    return false;
  }
  return new Date() > this.dueDate;
});

// Method to mark task as completed
taskSchema.methods.complete = function() {
  this.status = 'completed';
  this.completedAt = new Date();
  return this.save();
};

// Method to update status
taskSchema.methods.updateStatus = function(newStatus) {
  if (['pending', 'in_progress', 'completed', 'cancelled'].includes(newStatus)) {
    this.status = newStatus;
    if (newStatus === 'completed' && !this.completedAt) {
      this.completedAt = new Date();
    }
    return this.save();
  }
  throw new Error('Invalid status');
};

module.exports = mongoose.model('Task', taskSchema);
