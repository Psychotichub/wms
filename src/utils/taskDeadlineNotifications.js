const Task = require('../models/Task');
const Employee = require('../models/Employee');
const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');

/**
 * Check for tasks with approaching deadlines and send notifications
 * This should be called every hour or multiple times per day
 */
async function checkAndNotifyApproachingDeadlines() {
  try {
    const now = new Date();
    let totalChecked = 0;
    let totalNotified = 0;

    // Get all active tasks with due dates (not completed or cancelled)
    const tasks = await Task.find({
      dueDate: { $exists: true, $ne: null },
      status: { $nin: ['completed', 'cancelled'] }
    })
      .populate('assignedTo', 'user')
      .lean();

    if (tasks.length === 0) {
      console.log('No tasks with deadlines found');
      return { checked: 0, notified: 0 };
    }

    for (const task of tasks) {
      totalChecked++;
      
      if (!task.assignedTo || !task.assignedTo.user) {
        continue; // Skip tasks assigned to employees without user accounts
      }

      const employeeId = task.assignedTo._id;
      const dueDate = new Date(task.dueDate);
      const hoursUntilDeadline = (dueDate - now) / (1000 * 60 * 60);

      // Get user's notification preferences
      const preferences = await NotificationPreferences.findOne({ user: employeeId }).lean();
      if (!preferences) continue;

      // Check if deadline reminders are enabled
      if (!preferences.reminderSettings?.deadlineReminders?.enabled) {
        continue;
      }

      const hoursBefore = preferences.reminderSettings.deadlineReminders.hoursBefore || 24;
      const shouldNotify = hoursUntilDeadline > 0 && hoursUntilDeadline <= hoursBefore;

      if (shouldNotify) {
        // Check if we've already notified for this task today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endOfDay = new Date(today);
        endOfDay.setDate(endOfDay.getDate() + 1);

        const existingNotification = await Notification.findOne({
          recipient: employeeId,
          type: 'deadline_approaching',
          'data.taskId': task._id.toString(),
          createdAt: { $gte: today, $lt: endOfDay }
        });

        if (existingNotification && !preferences.reminderSettings.deadlineReminders.repeat) {
          continue; // Already notified today and repeat is disabled
        }

        // Format time remaining
        let timeRemaining = '';
        if (hoursUntilDeadline < 1) {
          const minutes = Math.floor(hoursUntilDeadline * 60);
          timeRemaining = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else if (hoursUntilDeadline < 24) {
          const hours = Math.floor(hoursUntilDeadline);
          timeRemaining = `${hours} hour${hours !== 1 ? 's' : ''}`;
        } else {
          const days = Math.floor(hoursUntilDeadline / 24);
          timeRemaining = `${days} day${days !== 1 ? 's' : ''}`;
        }

        const priority = task.priority === 'urgent' ? 'urgent' : 
                         task.priority === 'high' ? 'high' : 
                         hoursUntilDeadline < 1 ? 'high' : 'medium';

        await NotificationPreferences.sendNotificationIfAllowed(employeeId, {
          recipient: employeeId,
          title: 'Deadline Approaching',
          message: `Task "${task.title}" is due in ${timeRemaining}.`,
          type: 'deadline_approaching',
          priority,
          relatedEntity: {
            type: 'task',
            id: task._id
          },
          data: {
            taskId: task._id.toString(),
            taskTitle: task.title,
            dueDate: task.dueDate,
            hoursRemaining: hoursUntilDeadline
          }
        });

        totalNotified++;
      }
    }

    console.log(`Deadline approaching check completed: ${totalChecked} tasks checked, ${totalNotified} notifications sent`);
    return { checked: totalChecked, notified: totalNotified };
  } catch (error) {
    console.error('Error checking approaching deadlines:', error);
    throw error;
  }
}

/**
 * Check for tasks with overdue deadlines and send notifications
 * This should be called every hour or multiple times per day
 */
async function checkAndNotifyOverdueDeadlines() {
  try {
    const now = new Date();
    let totalChecked = 0;
    let totalNotified = 0;

    // Get all active tasks with overdue due dates (not completed or cancelled)
    const tasks = await Task.find({
      dueDate: { $exists: true, $ne: null, $lt: now },
      status: { $nin: ['completed', 'cancelled'] }
    })
      .populate('assignedTo', 'user')
      .lean();

    if (tasks.length === 0) {
      console.log('No overdue tasks found');
      return { checked: 0, notified: 0 };
    }

    for (const task of tasks) {
      totalChecked++;
      
      if (!task.assignedTo || !task.assignedTo.user) {
        continue; // Skip tasks assigned to employees without user accounts
      }

      const employeeId = task.assignedTo._id;
      const dueDate = new Date(task.dueDate);
      const hoursOverdue = (now - dueDate) / (1000 * 60 * 60);

      // Get user's notification preferences
      const preferences = await NotificationPreferences.findOne({ user: employeeId }).lean();
      if (!preferences) continue;

      // Check if overdue notifications are enabled
      if (!preferences.notificationTypes?.deadline_overdue) {
        continue;
      }

      // Check if we've already notified for this task today (max once per day)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const existingNotification = await Notification.findOne({
        recipient: employeeId,
        type: 'deadline_overdue',
        'data.taskId': task._id.toString(),
        createdAt: { $gte: today, $lt: endOfDay }
      });

      if (existingNotification) {
        continue; // Already notified today
      }

      // Format time overdue
      let timeOverdue = '';
      if (hoursOverdue < 24) {
        const hours = Math.floor(hoursOverdue);
        timeOverdue = `${hours} hour${hours !== 1 ? 's' : ''}`;
      } else {
        const days = Math.floor(hoursOverdue / 24);
        timeOverdue = `${days} day${days !== 1 ? 's' : ''}`;
      }

      const priority = task.priority === 'urgent' ? 'urgent' : 'high';

      await NotificationPreferences.sendNotificationIfAllowed(employeeId, {
        recipient: employeeId,
        title: 'Deadline Overdue',
        message: `Task "${task.title}" is overdue by ${timeOverdue}.`,
        type: 'deadline_overdue',
        priority,
        relatedEntity: {
          type: 'task',
          id: task._id
        },
        data: {
          taskId: task._id.toString(),
          taskTitle: task.title,
          dueDate: task.dueDate,
          hoursOverdue
        }
      });

      totalNotified++;
    }

    console.log(`Deadline overdue check completed: ${totalChecked} tasks checked, ${totalNotified} notifications sent`);
    return { checked: totalChecked, notified: totalNotified };
  } catch (error) {
    console.error('Error checking overdue deadlines:', error);
    throw error;
  }
}

module.exports = {
  checkAndNotifyApproachingDeadlines,
  checkAndNotifyOverdueDeadlines
};
