const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    trim: true
  },
  role: {
    type: String,
    required: true,
    enum: ['worker', 'supervisor', 'manager', 'admin'],
    default: 'worker'
  },
  department: {
    type: String,
    trim: true
  },
  skills: [{
    type: String,
    trim: true
  }],
  hourlyRate: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  hireDate: {
    type: Date,
    default: Date.now
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  profileImage: {
    type: String, // URL to profile image
    trim: true
  },
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  emergencyContact: {
    name: String,
    phone: String,
    relationship: String
  },
  productivityMetrics: {
    tasksCompleted: { type: Number, default: 0 },
    averageTaskTime: { type: Number, default: 0 }, // in minutes
    efficiencyRating: { type: Number, default: 0, min: 0, max: 5 },
    totalHoursWorked: { type: Number, default: 0 }
  },
  locationPreferences: {
    selectedGeofences: [{
      geofenceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Location',
        required: true
      },
      isDefault: {
        type: Boolean,
        default: false
      },
      addedAt: {
        type: Date,
        default: Date.now
      }
    }],
    workingHours: [{
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
      isDefault: {
        type: Boolean,
        default: false
      },
      addedAt: {
        type: Date,
        default: Date.now
      }
    }],
    lastUpdated: { type: Date, default: Date.now }
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index is automatically created by unique: true on email field
employeeSchema.index({ role: 1 });
employeeSchema.index({ isActive: 1 });
employeeSchema.index({ department: 1 });
employeeSchema.index({ user: 1 }, { sparse: true });

// Virtual for full name (if needed for future extensions)
employeeSchema.virtual('fullName').get(function() {
  return this.name;
});

// Method to calculate productivity metrics
employeeSchema.methods.updateProductivityMetrics = function(newMetrics) {
  this.productivityMetrics = { ...this.productivityMetrics, ...newMetrics };
  return this.save();
};

// Method to check if employee can be assigned to task based on skills
employeeSchema.methods.hasRequiredSkills = function(requiredSkills) {
  if (!requiredSkills || requiredSkills.length === 0) return true;
  return requiredSkills.every(skill => this.skills.includes(skill));
};

module.exports = mongoose.model('Employee', employeeSchema);
