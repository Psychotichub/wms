const mongoose = require('mongoose');

const notificationPreferencesSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
    unique: true
  },
  pushEnabled: {
    type: Boolean,
    default: true
  },
  emailEnabled: {
    type: Boolean,
    default: false // Email notifications not implemented yet
  },
  notificationTypes: {
    task_assigned: { type: Boolean, default: true },
    task_completed: { type: Boolean, default: true },
    deadline_approaching: { type: Boolean, default: true },
    deadline_overdue: { type: Boolean, default: true },
    time_approved: { type: Boolean, default: true },
    time_rejected: { type: Boolean, default: true },
    system_announcement: { type: Boolean, default: true },
    reminder: { type: Boolean, default: true },
    overtime_alert: { type: Boolean, default: true },
    schedule_change: { type: Boolean, default: true },
    low_stock: { type: Boolean, default: true },
    daily_report_missing: { type: Boolean, default: true }
  },
  reminderSettings: {
    deadlineReminders: {
      enabled: { type: Boolean, default: true },
      hoursBefore: { type: Number, default: 24 }, // Hours before deadline
      repeat: { type: Boolean, default: false }
    },
    taskReminders: {
      enabled: { type: Boolean, default: true },
      inactiveHours: { type: Number, default: 2 }, // Hours of inactivity before reminder
    },
    dailySummary: {
      enabled: { type: Boolean, default: false },
      time: { type: String, default: '18:00' } // HH:MM format
    }
  },
  quietHours: {
    enabled: { type: Boolean, default: false },
    startTime: { type: String, default: '22:00' }, // HH:MM format
    endTime: { type: String, default: '08:00' }, // HH:MM format
    timezone: { type: String, default: 'UTC' }
  },
  pushToken: {
    type: String,
    sparse: true // Allow null values but ensure uniqueness
  },
  webPushSubscription: {
    type: mongoose.Schema.Types.Mixed
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes are automatically created by unique: true and sparse: true options

// Method to check if notification type is enabled
notificationPreferencesSchema.methods.isNotificationEnabled = function(type) {
  return this.pushEnabled && this.notificationTypes[type];
};

// Method to check if current time is within quiet hours
notificationPreferencesSchema.methods.isInQuietHours = function() {
  if (!this.quietHours.enabled) return false;

  const now = new Date();
  const currentTime = now.getHours() * 100 + now.getMinutes(); // Convert to HHMM format

  const startTime = parseInt(this.quietHours.startTime.replace(':', ''));
  const endTime = parseInt(this.quietHours.endTime.replace(':', ''));

  if (startTime < endTime) {
    // Same day range (e.g., 08:00 to 18:00)
    return currentTime >= startTime && currentTime <= endTime;
  } else {
    // Overnight range (e.g., 22:00 to 08:00)
    return currentTime >= startTime || currentTime <= endTime;
  }
};

// Method to update push token
notificationPreferencesSchema.methods.updatePushToken = function(token) {
  this.pushToken = token;
  this.lastUpdated = new Date();
  return this.save();
};

// Method to update web push subscription
notificationPreferencesSchema.methods.updateWebPushSubscription = function(subscription) {
  this.webPushSubscription = subscription;
  this.lastUpdated = new Date();
  return this.save();
};

// Static method to get or create preferences for user
notificationPreferencesSchema.statics.getOrCreateForUser = async function(userId) {
  let preferences = await this.findOne({ user: userId });
  if (!preferences) {
    preferences = new this({ user: userId });
    await preferences.save();
  }
  return preferences;
};

// Static method to send notification if user allows it
notificationPreferencesSchema.statics.sendNotificationIfAllowed = async function(userId, notificationData) {
  const preferences = await this.getOrCreateForUser(userId);

  if (preferences.isNotificationEnabled(notificationData.type)) {
    // Check quiet hours
    if (preferences.isInQuietHours() && notificationData.priority !== 'urgent') {
      // Schedule for after quiet hours or skip
      const scheduledTime = new Date();
      const endTime = preferences.quietHours.endTime.split(':');
      scheduledTime.setHours(parseInt(endTime[0]), parseInt(endTime[1]), 0, 0);

      if (scheduledTime <= new Date()) {
        scheduledTime.setDate(scheduledTime.getDate() + 1);
      }

      notificationData.scheduledFor = scheduledTime;
    }

    // Add push token if available
    if (preferences.pushToken) {
      notificationData.pushToken = preferences.pushToken;
    }
    // Add web push subscription if available
    if (preferences.webPushSubscription) {
      notificationData.webPushSubscription = preferences.webPushSubscription;
    }

    return await mongoose.model('Notification').createAndSend(notificationData);
  }

  return null; // Notification not sent due to preferences
};

module.exports = mongoose.model('NotificationPreferences', notificationPreferencesSchema);
