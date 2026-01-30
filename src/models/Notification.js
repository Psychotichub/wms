const mongoose = require('mongoose');
const { sendExpoPushNotification } = require('../utils/expoPush');
const { sendWebPushNotification } = require('../utils/webPush');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: [
      'task_assigned',
      'task_completed',
      'deadline_approaching',
      'deadline_overdue',
      'time_approved',
      'time_rejected',
      'system_announcement',
      'reminder',
      'overtime_alert',
      'schedule_change',
      'low_stock',
      'daily_report_missing',
      'contract_exceeded',
      'inventory_exceeded',
      'attendance_checkin',
      'attendance_checkout'
    ],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'archived'],
    default: 'pending'
  },
  relatedEntity: {
    type: {
      type: String,
      enum: ['task', 'time_entry', 'project', 'employee', 'system']
    },
    id: mongoose.Schema.Types.ObjectId
  },
  data: {
    type: mongoose.Schema.Types.Mixed // Additional contextual data
  },
  pushToken: {
    type: String // Expo push token for delivery
  },
  webPushSubscription: {
    type: mongoose.Schema.Types.Mixed
  },
  pushResponse: {
    type: mongoose.Schema.Types.Mixed // Response from push service
  },
  webPushResponse: {
    type: mongoose.Schema.Types.Mixed
  },
  scheduledFor: {
    type: Date // For scheduled notifications
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  readAt: {
    type: Date
  },
  expiresAt: {
    type: Date // For time-sensitive notifications
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ status: 1 });
notificationSchema.index({ scheduledFor: 1 });
notificationSchema.index({ expiresAt: 1 });
notificationSchema.index({ 'data.taskId': 1, type: 1, createdAt: -1 }); // For deadline notification lookups

// Virtual for isRead
notificationSchema.virtual('isRead').get(function() {
  return this.status === 'read';
});

// Virtual for isExpired
notificationSchema.virtual('isExpired').get(function() {
  return this.expiresAt && new Date() > this.expiresAt;
});

// Method to mark as read
notificationSchema.methods.markAsRead = function() {
  this.status = 'read';
  this.readAt = new Date();
  return this.save();
};

// Method to mark as delivered
notificationSchema.methods.markAsDelivered = function(response = null) {
  this.status = 'delivered';
  if (response) {
    this.pushResponse = response;
  }
  return this.save();
};

// Static method to create and send notification
notificationSchema.statics.createAndSend = async function(notificationData) {
  // Always create and save notification first (even if user is offline)
  const notification = new this({
    ...notificationData,
    status: 'pending' // Start as pending until delivered
  });
  await notification.save();

  // If notification is scheduled for a future time, don't send immediately
  if (notification.scheduledFor && new Date(notification.scheduledFor) > new Date()) {
    return notification; // Return without sending, will be processed by scheduled notification processor
  }

  let delivered = false;

  // If push token is available, try to send push notification
  if (notification.pushToken) {
    try {
      const tickets = await sendExpoPushNotification({
        to: notification.pushToken,
        title: notification.title,
        body: notification.message,
        data: {
          notificationId: notification._id,
          type: notification.type,
          ...notification.data
        }
      });
      await notification.markAsDelivered(tickets);
      delivered = true;
    } catch (error) {
      console.error('Failed to send push notification (user may be offline):', error);
      // Keep status as 'pending' - will be delivered when user comes online
    }
  }

  // If web push subscription is available, try to send web push notification
  if (notification.webPushSubscription) {
    try {
      const payload = JSON.stringify({
        notificationId: String(notification._id),
        title: notification.title,
        message: notification.message,
        type: notification.type,
        data: notification.data || {},
      });
      const resp = await sendWebPushNotification({
        subscription: notification.webPushSubscription,
        payload,
      });
      notification.webPushResponse = resp;
      if (!delivered) {
        await notification.markAsDelivered(resp);
        delivered = true;
      } else {
        await notification.save();
      }
    } catch (error) {
      console.error('Failed to send web push notification (user may be offline):', error);
      // Keep status as 'pending' - will be delivered when user comes online
    }
  }

  // If neither push method worked, notification remains 'pending' for later delivery
  // This ensures users get notifications when they come back online

  return notification;
};

// Static method to process scheduled notifications that are ready to be sent
notificationSchema.statics.processScheduledNotifications = async function() {
  const now = new Date();
  const scheduledNotifications = await this.find({
    scheduledFor: { $exists: true, $lte: now },
    status: { $in: ['pending', 'sent'] } // Process pending and sent notifications
  }).limit(100); // Process in batches

  let processed = 0;
  for (const notification of scheduledNotifications) {
    try {
      let delivered = false;

      // If push token is available, try to send push notification
      if (notification.pushToken) {
        try {
          const tickets = await sendExpoPushNotification({
            to: notification.pushToken,
            title: notification.title,
            body: notification.message,
            data: {
              notificationId: notification._id,
              type: notification.type,
              ...notification.data
            }
          });
          await notification.markAsDelivered(tickets);
          delivered = true;
        } catch (error) {
          console.error(`Failed to send scheduled push notification ${notification._id} (user may be offline):`, error);
          // Keep as pending for later delivery
        }
      }

      // If web push subscription is available, try to send web push notification
      if (notification.webPushSubscription) {
        try {
          const payload = JSON.stringify({
            notificationId: String(notification._id),
            title: notification.title,
            message: notification.message,
            type: notification.type,
            data: notification.data || {},
          });
          const resp = await sendWebPushNotification({
            subscription: notification.webPushSubscription,
            payload,
          });
          notification.webPushResponse = resp;
          if (!delivered) {
            await notification.markAsDelivered(resp);
            delivered = true;
          } else {
            await notification.save();
          }
        } catch (error) {
          console.error(`Failed to send scheduled web push notification ${notification._id} (user may be offline):`, error);
          // Keep as pending for later delivery
        }
      }

      // If neither method worked, notification remains 'pending' for later delivery
      processed++;
    } catch (error) {
      console.error(`Error processing scheduled notification ${notification._id}:`, error);
    }
  }

  return { processed, total: scheduledNotifications.length };
};

// Static method to get user notifications
notificationSchema.statics.getUserNotifications = function(userId, options = {}) {
  const { status, type, limit = 20, page = 1, includeExpired = false } = options;

  const query = { recipient: userId };

  // Handle status - can be a string or an object (for $nin queries)
  if (status) {
    if (typeof status === 'object' && status.$nin) {
      query.status = status;
    } else {
      query.status = status;
    }
  }
  
  if (type) query.type = type;
  if (!includeExpired) {
    query.$or = [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } }
    ];
  }

  return this.find(query)
    .populate('sender', 'name email')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip((page - 1) * limit);
};

// Static method to clean up old notifications
notificationSchema.statics.cleanupOldNotifications = function(daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  return this.deleteMany({
    createdAt: { $lt: cutoffDate },
    status: { $in: ['read', 'archived'] }
  });
};

module.exports = mongoose.model('Notification', notificationSchema);
