const mongoose = require('mongoose');

const todoSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  reminder: {
    enabled: {
      type: Boolean,
      default: false
    },
    date: {
      type: Date
    },
    notified: {
      type: Boolean,
      default: false
    }
  },
  category: {
    type: String,
    trim: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
todoSchema.index({ user: 1, createdAt: -1 });
todoSchema.index({ employee: 1, createdAt: -1 });
todoSchema.index({ completed: 1 });
todoSchema.index({ 'reminder.enabled': 1, 'reminder.date': 1 });
todoSchema.index({ 'reminder.date': 1, 'reminder.notified': 1 });

// Method to mark as completed
todoSchema.methods.markAsCompleted = function() {
  this.completed = true;
  this.completedAt = new Date();
  return this.save();
};

// Method to mark reminder as notified
todoSchema.methods.markReminderNotified = function() {
  this.reminder.notified = true;
  return this.save();
};

module.exports = mongoose.model('Todo', todoSchema);
