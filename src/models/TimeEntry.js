const mongoose = require('mongoose');

const timeEntrySchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  taskId: {
    type: String,
    required: true // Could be daily report ID, material ID, etc.
  },
  taskType: {
    type: String,
    required: true,
    enum: ['daily_report', 'material', 'panel', 'other']
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date
  },
  duration: {
    type: Number, // Duration in minutes
    default: 0
  },
  isManual: {
    type: Boolean,
    default: false // True for manual entries, false for automatic tracking
  },
  isBillable: {
    type: Boolean,
    default: true
  },
  category: {
    type: String,
    enum: ['work', 'meeting', 'training', 'break', 'other'],
    default: 'work'
  },
  tags: [{
    type: String,
    trim: true
  }],
  status: {
    type: String,
    enum: ['active', 'completed', 'approved', 'rejected'],
    default: 'active'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  approvedAt: {
    type: Date
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  overtime: {
    isOvertime: { type: Boolean, default: false },
    overtimeHours: { type: Number, default: 0 },
    overtimeRate: { type: Number, default: 1.5 } // 1.5x regular rate
  },
  location: {
    latitude: Number,
    longitude: Number,
    address: String
  },
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
timeEntrySchema.index({ employee: 1, startTime: -1 });
timeEntrySchema.index({ taskId: 1, taskType: 1 });
timeEntrySchema.index({ status: 1 });
timeEntrySchema.index({ startTime: -1, endTime: -1 });

// Virtual for formatted duration
timeEntrySchema.virtual('formattedDuration').get(function() {
  if (!this.duration) return '0h 0m';
  const hours = Math.floor(this.duration / 60);
  const minutes = this.duration % 60;
  return `${hours}h ${minutes}m`;
});

// Virtual for total cost (if hourly rate is available)
timeEntrySchema.virtual('totalCost').get(function() {
  // This would need employee hourly rate - calculated on population
  return 0; // Placeholder
});

// Method to calculate duration
timeEntrySchema.methods.calculateDuration = function() {
  if (!this.endTime) return 0;

  const durationMs = this.endTime - this.startTime;
  this.duration = Math.round(durationMs / (1000 * 60)); // Convert to minutes

  // Calculate overtime (assuming 8 hours = 480 minutes per day)
  const regularHoursPerDay = 8 * 60; // 480 minutes
  const startOfDay = new Date(this.startTime);
  startOfDay.setHours(0, 0, 0, 0);

  // Check if this entry crosses into overtime hours
  const dayStart = new Date(this.startTime);
  dayStart.setHours(0, 0, 0, 0);

  const workStartTime = this.startTime.getTime() - dayStart.getTime(); // Minutes from start of day
  const workStartMinutes = Math.floor(workStartTime / (1000 * 60));

  if (workStartMinutes + this.duration > regularHoursPerDay) {
    const regularWork = Math.max(0, regularHoursPerDay - workStartMinutes);
    const overtimeWork = this.duration - regularWork;
    this.overtime.isOvertime = true;
    this.overtime.overtimeHours = overtimeWork / 60; // Convert to hours
  }

  return this.duration;
};

// Method to complete a time entry
timeEntrySchema.methods.complete = function(notes = null) {
  this.endTime = new Date();
  this.status = 'completed';
  this.calculateDuration();

  if (notes) {
    this.notes = notes;
  }

  return this.save();
};

// Static method to get timesheet for a date range
timeEntrySchema.statics.getTimesheet = function(employeeId, startDate, endDate) {
  return this.find({
    employee: employeeId,
    startTime: { $gte: startDate, $lte: endDate }
  })
  .populate('employee', 'name email hourlyRate')
  .populate('approvedBy', 'name')
  .sort({ startTime: -1 });
};

// Static method to get project-level time aggregation
timeEntrySchema.statics.getProjectTime = function(projectId, taskType) {
  return this.aggregate([
    {
      $match: {
        taskId: projectId,
        taskType: taskType,
        status: { $in: ['completed', 'approved'] }
      }
    },
    {
      $group: {
        _id: '$employee',
        totalMinutes: { $sum: '$duration' },
        entries: { $sum: 1 },
        totalOvertimeHours: { $sum: '$overtime.overtimeHours' }
      }
    },
    {
      $lookup: {
        from: 'employees',
        localField: '_id',
        foreignField: '_id',
        as: 'employee'
      }
    },
    {
      $unwind: '$employee'
    },
    {
      $project: {
        employee: {
          _id: '$employee._id',
          name: '$employee.name',
          email: '$employee.email'
        },
        totalHours: { $divide: ['$totalMinutes', 60] },
        totalMinutes: 1,
        entries: 1,
        totalOvertimeHours: 1
      }
    }
  ]);
};

module.exports = mongoose.model('TimeEntry', timeEntrySchema);
