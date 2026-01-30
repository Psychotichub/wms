const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  clockInTime: {
    type: Date,
    required: true
  },
  clockOutTime: {
    type: Date
  },
  totalHours: {
    type: Number,
    default: 0
  },
  breakStartTime: {
    type: Date
  },
  breakEndTime: {
    type: Date
  },
  totalBreakHours: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'on_break'],
    default: 'active'
  },
  isManualCheckout: {
    type: Boolean,
    default: false
  },
  location: {
    latitude: Number,
    longitude: Number,
    address: String,
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location'
    },
    locationName: String,
    accuracy: Number, // GPS accuracy in meters
    geofenceTriggered: {
      type: Boolean,
      default: false
    },
    // Device information for security
    deviceInfo: {
      deviceId: String,
      deviceName: String,
      deviceType: { type: String, enum: ['ios', 'android', 'web'] },
      appVersion: String,
      osVersion: String
    },
    // Security validation
    validationStatus: {
      type: String,
      enum: ['pending', 'validated', 'suspicious', 'rejected'],
      default: 'pending'
    },
    validationReason: String,
    // Location validation
    locationValidation: {
      isMockLocation: { type: Boolean, default: false },
      accuracy: Number,
      speed: Number, // m/s
      altitude: Number,
      heading: Number
    }
  },
  notes: {
    type: String,
    trim: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  approvedAt: {
    type: Date
  },
  isOvertime: {
    type: Boolean,
    default: false
  },
  overtimeHours: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
attendanceSchema.index({ employee: 1, date: -1 });
attendanceSchema.index({ date: -1, status: 1 });

// Virtual for formatted duration
attendanceSchema.virtual('formattedDuration').get(function() {
  if (!this.totalHours) return '0h 0m';
  const hours = Math.floor(this.totalHours);
  const minutes = Math.round((this.totalHours - hours) * 60);
  return `${hours}h ${minutes}m`;
});

// Method to calculate total hours worked
attendanceSchema.methods.calculateTotalHours = function() {
  if (!this.clockOutTime) return 0;

  let totalMinutes = (this.clockOutTime - this.clockInTime) / (1000 * 60); // Convert to minutes

  // Subtract break time if applicable
  if (this.breakStartTime && this.breakEndTime) {
    const breakMinutes = (this.breakEndTime - this.breakStartTime) / (1000 * 60);
    totalMinutes -= breakMinutes;
    this.totalBreakHours = breakMinutes / 60; // Convert to hours
  }

  this.totalHours = totalMinutes / 60; // Convert to hours
  return this.totalHours;
};

// Method to clock out and calculate final hours
attendanceSchema.methods.clockOut = function(location = null, notes = null, isManual = false) {
  this.clockOutTime = new Date();
  this.status = 'completed';
  this.isManualCheckout = isManual;

  if (location) {
    this.location = location;
  }

  if (notes) {
    this.notes = notes;
  }

  this.calculateTotalHours();
  return this.save();
};

// Static method to get attendance for a date range
attendanceSchema.statics.getAttendanceReport = function(employeeId, startDate, endDate) {
  return this.find({
    employee: employeeId,
    date: { $gte: startDate, $lte: endDate }
  })
  .populate('employee', 'name email')
  .populate('approvedBy', 'name')
  .sort({ date: -1, clockInTime: -1 });
};

module.exports = mongoose.model('Attendance', attendanceSchema);
