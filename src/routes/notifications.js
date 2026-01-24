const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');
const { validate, z } = require('../middleware/validation');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');

// Middleware to check if user is authenticated
const requireAuth = [authenticateToken, requireActiveSite];

// Helper function to get or create Employee record for a user
// Admins can have Employee records auto-created if they don't exist
const getOrCreateEmployeeForUser = async (userId, userRole, userEmail, userName) => {
  const Employee = require('../models/Employee');
  let employee = await Employee.findOne({ user: userId });
  
  if (!employee) {
    // If user is admin, try to find or create Employee record
    if (userRole === 'admin') {
      const normalizedEmail = userEmail ? userEmail.toLowerCase().trim() : null;
      
      // First, check if an Employee with this email already exists
      if (normalizedEmail) {
        const existingEmployee = await Employee.findOne({ email: normalizedEmail });
        if (existingEmployee) {
          // If Employee exists but isn't linked to this user, link it
          if (!existingEmployee.user) {
            existingEmployee.user = userId;
            await existingEmployee.save();
            return existingEmployee;
          }
          // If Employee is linked to a different user, use it anyway (might be shared admin account)
          // But prefer to return the existing one linked to this user if possible
          if (existingEmployee.user.toString() !== userId.toString()) {
            // Employee exists but linked to different user - return it anyway for now
            // In future, might want to handle this differently
            return existingEmployee;
          }
        }
      }
      
      // No existing Employee found, create a new one
      try {
        employee = await Employee.create({
          name: userName || 'Admin User',
          email: normalizedEmail || `admin-${userId}@system.local`,
          role: 'admin',
          user: userId,
          isActive: true
        });
      } catch (error) {
        // If creation fails due to duplicate email, try to find and link existing Employee
        if (error.code === 11000 && error.keyPattern?.email) {
          const existingEmployee = await Employee.findOne({ email: normalizedEmail || `admin-${userId}@system.local` });
          if (existingEmployee) {
            // Link existing Employee to this user if not already linked
            if (!existingEmployee.user) {
              existingEmployee.user = userId;
              await existingEmployee.save();
              return existingEmployee;
            }
            // Return existing Employee even if linked to different user
            return existingEmployee;
          }
        }
        // Re-throw if it's not a duplicate key error
        throw error;
      }
    } else {
      // Non-admin users must have Employee records
      return null;
    }
  }
  
  return employee;
};

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const notificationsQuerySchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  limit: z.union([z.number(), z.string()]).optional(),
  page: z.union([z.number(), z.string()]).optional(),
  includeExpired: z.union([z.boolean(), z.string()]).optional()
});

const updatePreferencesSchema = z.record(z.any());

const pushTokenSchema = z.object({
  pushToken: z.string().min(1)
});

const webPushSubscriptionSchema = z.object({
  subscription: z.any()
});

const sendNotificationSchema = z.object({
  recipientId: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  type: z.string().min(1),
  priority: z.string().optional(),
  data: z.any().optional()
});

const broadcastSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  type: z.string().min(1),
  priority: z.string().optional(),
  data: z.any().optional(),
  userFilter: z.any().optional()
});

const statsQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional()
});

// GET /api/notifications - Get user notifications
router.get('/', requireAuth, validate(notificationsQuerySchema, { source: 'query' }), async (req, res) => {
  try {
    const { status, type, limit = 20, page = 1, includeExpired = false } = req.data;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const userEmail = req.user?.email;
    const userName = req.user?.name;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get or create Employee record (admins can have auto-created records)
    // Notifications use Employee ID as recipient
    const employee = await getOrCreateEmployeeForUser(userId, userRole, userEmail, userName);
    if (!employee) {
      // For non-admin users without Employee records, return empty results
      return res.json({
        notifications: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 0
        },
        unreadCount: 0
      });
    }

    const employeeId = employee._id;

    const notifications = await Notification.getUserNotifications(employeeId, {
      status,
      type,
      limit: parseInt(limit),
      page: parseInt(page),
      includeExpired: includeExpired === 'true'
    });

    const total = await Notification.countDocuments({
      recipient: employeeId,
      ...(status && { status }),
      ...(type && { type }),
      ...(!includeExpired || includeExpired !== 'true' ? {
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } }
        ]
      } : {})
    });

    // Get unread count
    const unreadCount = await Notification.countDocuments({
      recipient: employeeId,
      status: { $ne: 'read' },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } }
      ]
    });

    res.json({
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// IMPORTANT: These routes must be defined BEFORE parameterized routes like /:id
// GET /api/notifications/preferences - Get user notification preferences
router.get('/preferences', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    const userRole = req.user?.role;
    const userEmail = req.user?.email;
    const userName = req.user?.name;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get or create Employee record (admins can have auto-created records)
    const employee = await getOrCreateEmployeeForUser(userId, userRole, userEmail, userName);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee record not found. Please ensure your user account is linked to an employee record.' });
    }

    // NotificationPreferences.user references Employee, not User
    const preferences = await NotificationPreferences.getOrCreateForUser(employee._id);

    res.json({ preferences });
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
});

// PUT /api/notifications/preferences - Update notification preferences
router.put('/preferences', requireAuth, validate(updatePreferencesSchema), async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    const userRole = req.user?.role;
    const userEmail = req.user?.email;
    const userName = req.user?.name;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get or create Employee record (admins can have auto-created records)
    const employee = await getOrCreateEmployeeForUser(userId, userRole, userEmail, userName);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee record not found. Please ensure your user account is linked to an employee record.' });
    }

    // NotificationPreferences.user references Employee, not User
    const preferences = await NotificationPreferences.getOrCreateForUser(employee._id);

    // Update preferences
    const updateData = req.data;
    delete updateData.user; // Prevent user field from being updated
    delete updateData.createdAt; // Prevent timestamps from being updated
    delete updateData.updatedAt;

    Object.keys(updateData).forEach(key => {
      if (key === 'notificationTypes') {
        preferences.notificationTypes = { ...preferences.notificationTypes, ...updateData[key] };
      } else if (key === 'reminderSettings') {
        preferences.reminderSettings = { ...preferences.reminderSettings, ...updateData[key] };
      } else if (key === 'quietHours') {
        preferences.quietHours = { ...preferences.quietHours, ...updateData[key] };
      } else if (preferences[key] !== undefined) {
        preferences[key] = updateData[key];
      }
    });

    await preferences.save();

    res.json({
      preferences,
      message: 'Notification preferences updated successfully'
    });
  } catch (error) {
    console.error('Error updating notification preferences:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

// POST /api/notifications/preferences/push-token - Update push token
router.post('/preferences/push-token', requireAuth, validate(pushTokenSchema), async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    const userRole = req.user?.role;
    const userEmail = req.user?.email;
    const userName = req.user?.name;
    const { pushToken } = req.data;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!pushToken) {
      return res.status(400).json({ error: 'Push token is required' });
    }

    // Get or create Employee record (admins can have auto-created records)
    const employee = await getOrCreateEmployeeForUser(userId, userRole, userEmail, userName);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee record not found. Please ensure your user account is linked to an employee record.' });
    }

    // NotificationPreferences.user references Employee, not User
    const preferences = await NotificationPreferences.getOrCreateForUser(employee._id);
    await preferences.updatePushToken(pushToken);

    res.json({ message: 'Push token updated successfully' });
  } catch (error) {
    console.error('Error updating push token:', error);
    res.status(500).json({ error: 'Failed to update push token' });
  }
});

// POST /api/notifications/preferences/web-push-subscription - Update web push subscription (web only)
router.post('/preferences/web-push-subscription', requireAuth, validate(webPushSubscriptionSchema), async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    const userRole = req.user?.role;
    const userEmail = req.user?.email;
    const userName = req.user?.name;
    const { subscription } = req.data;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!subscription) {
      return res.status(400).json({ error: 'Subscription is required' });
    }

    // Get or create Employee record (admins can have auto-created records)
    const employee = await getOrCreateEmployeeForUser(userId, userRole, userEmail, userName);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee record not found. Please ensure your user account is linked to an employee record.' });
    }

    // NotificationPreferences.user references Employee, not User
    const preferences = await NotificationPreferences.getOrCreateForUser(employee._id);
    await preferences.updateWebPushSubscription(subscription);

    return res.json({ message: 'Web push subscription updated successfully' });
  } catch (error) {
    console.error('Error updating web push subscription:', error);
    res.status(500).json({ error: 'Failed to update web push subscription' });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', requireAuth, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const userEmail = req.user?.email;
    const userName = req.user?.name;
    const notificationId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get or create Employee record (admins can have auto-created records)
    const employee = await getOrCreateEmployeeForUser(userId, userRole, userEmail, userName);
    if (!employee) {
      return res.status(404).json({ error: 'Employee record not found' });
    }

    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: employee._id
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await notification.markAsRead();

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const userEmail = req.user?.email;
    const userName = req.user?.name;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get or create Employee record (admins can have auto-created records)
    const employee = await getOrCreateEmployeeForUser(userId, userRole, userEmail, userName);
    if (!employee) {
      return res.json({ message: 'All notifications marked as read' }); // No employee = no notifications
    }

    await Notification.updateMany(
      { recipient: employee._id, status: { $ne: 'read' } },
      { status: 'read', readAt: new Date() }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// DELETE /api/notifications/:id - Archive notification
router.delete('/:id', requireAuth, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const userEmail = req.user?.email;
    const userName = req.user?.name;
    const notificationId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get or create Employee record (admins can have auto-created records)
    const employee = await getOrCreateEmployeeForUser(userId, userRole, userEmail, userName);
    if (!employee) {
      return res.status(404).json({ error: 'Employee record not found' });
    }

    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: employee._id
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    notification.status = 'archived';
    await notification.save();

    res.json({ message: 'Notification archived' });
  } catch (error) {
    console.error('Error archiving notification:', error);
    res.status(500).json({ error: 'Failed to archive notification' });
  }
});

// POST /api/notifications/send - Send notification (admin/system only)
router.post('/send', requireAuth, validate(sendNotificationSchema), async (req, res) => {
  try {
    // This should check if user is admin
    const senderId = req.user?.id;
    const { recipientId, title, message, type, priority, data } = req.data;

    if (!recipientId || !title || !message || !type) {
      return res.status(400).json({
        error: 'Recipient, title, message, and type are required'
      });
    }

    const notificationData = {
      recipient: recipientId,
      sender: senderId,
      title,
      message,
      type,
      priority: priority || 'medium',
      data: data || {}
    };

    const notification = await NotificationPreferences.sendNotificationIfAllowed(
      recipientId,
      notificationData
    );

    if (notification) {
      res.status(201).json({
        notification,
        message: 'Notification sent successfully'
      });
    } else {
      res.status(200).json({
        message: 'Notification not sent (user preferences or quiet hours)'
      });
    }
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// POST /api/notifications/broadcast - Send broadcast notification to all users
router.post('/broadcast', requireAuth, validate(broadcastSchema), async (req, res) => {
  try {
    // This should check if user is admin
    const senderId = req.user?.id;
    const { title, message, type, priority, data, userFilter } = req.data;

    if (!title || !message || !type) {
      return res.status(400).json({
        error: 'Title, message, and type are required'
      });
    }

    // Get all users (with optional filter)
    const query = {};
    if (userFilter) {
      Object.assign(query, userFilter);
    }

    const users = await require('../models/Employee').find(query).select('_id');

    const notifications = [];
    for (const user of users) {
      try {
        const notification = await NotificationPreferences.sendNotificationIfAllowed(
          user._id,
          {
            recipient: user._id,
            sender: senderId,
            title,
            message,
            type,
            priority: priority || 'medium',
            data: data || {}
          }
        );

        if (notification) {
          notifications.push(notification);
        }
      } catch (error) {
        console.error(`Failed to send notification to user ${user._id}:`, error);
      }
    }

    res.status(201).json({
      sent: notifications.length,
      total: users.length,
      message: `Broadcast notification sent to ${notifications.length} users`
    });
  } catch (error) {
    console.error('Error sending broadcast notification:', error);
    res.status(500).json({ error: 'Failed to send broadcast notification' });
  }
});

// GET /api/notifications/stats - Get notification statistics (admin only)
router.get('/stats', requireAuth, validate(statsQuerySchema, { source: 'query' }), async (req, res) => {
  try {
    // This should check if user is admin
    const { startDate, endDate } = req.data;

    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const stats = await Notification.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: {
            type: '$type',
            status: '$status'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.type',
          statuses: {
            $push: {
              status: '$_id.status',
              count: '$count'
            }
          },
          total: { $sum: '$count' }
        }
      }
    ]);

    res.json({ stats });
  } catch (error) {
    console.error('Error fetching notification stats:', error);
    res.status(500).json({ error: 'Failed to fetch notification statistics' });
  }
});

module.exports = router;
