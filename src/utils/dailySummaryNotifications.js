const Employee = require('../models/Employee');
const Task = require('../models/Task');
const NotificationPreferences = require('../models/NotificationPreferences');

/**
 * Send daily summary notifications to users who have it enabled
 * This should be called at the configured time for each user (typically 6:00 PM)
 * Since users can have different times, we check every hour and send to users whose time matches
 */
async function sendDailySummaries() {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Only run at the top of the hour (minute 0) to avoid duplicate sends
    if (currentMinute !== 0) {
      return { checked: 0, notified: 0 };
    }

    let totalChecked = 0;
    let totalNotified = 0;

    // Get all employees with user accounts
    const employees = await Employee.find({ user: { $exists: true, $ne: null } })
      .populate('user', 'name email')
      .lean();

    if (employees.length === 0) {
      console.log('No employees with user accounts found');
      return { checked: 0, notified: 0 };
    }

    for (const employee of employees) {
      totalChecked++;

      const employeeId = employee._id;
      
      // Get user's notification preferences
      const preferences = await NotificationPreferences.findOne({ user: employeeId }).lean();
      if (!preferences) continue;

      // Check if daily summary is enabled
      if (!preferences.reminderSettings?.dailySummary?.enabled) {
        continue;
      }

      // Parse the configured time (format: "HH:MM")
      const summaryTime = preferences.reminderSettings.dailySummary.time || '18:00';
      const [summaryHour, summaryMinute] = summaryTime.split(':').map(Number);

      // Check if it's time to send the summary for this user
      if (currentHour !== summaryHour || currentMinute !== summaryMinute) {
        continue;
      }

      // Check if we've already sent a summary today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const existingNotification = await require('../models/Notification').findOne({
        recipient: employeeId,
        type: 'reminder',
        'data.summaryType': 'daily',
        createdAt: { $gte: today, $lt: endOfDay }
      });

      if (existingNotification) {
        continue; // Already sent today
      }

      // Get task statistics for today
      const startOfDay = new Date(today);
      const tasks = await Task.find({
        assignedTo: employeeId,
        status: { $nin: ['completed', 'cancelled'] }
      }).lean();

      const pendingTasks = tasks.filter(t => t.status === 'pending').length;
      const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
      const overdueTasks = tasks.filter(t => {
        if (!t.dueDate) return false;
        return new Date(t.dueDate) < now && t.status !== 'completed';
      }).length;

      // Build summary message
      let summaryMessage = 'Daily Task Summary:\n';
      summaryMessage += `• ${pendingTasks} pending task${pendingTasks !== 1 ? 's' : ''}\n`;
      summaryMessage += `• ${inProgressTasks} in progress task${inProgressTasks !== 1 ? 's' : ''}\n`;
      if (overdueTasks > 0) {
        summaryMessage += `• ⚠️ ${overdueTasks} overdue task${overdueTasks !== 1 ? 's' : ''}`;
      }

      if (pendingTasks === 0 && inProgressTasks === 0 && overdueTasks === 0) {
        summaryMessage = 'Daily Task Summary: No active tasks assigned.';
      }

      await NotificationPreferences.sendNotificationIfAllowed(employeeId, {
        recipient: employeeId,
        title: 'Daily Task Summary',
        message: summaryMessage,
        type: 'reminder',
        priority: overdueTasks > 0 ? 'high' : 'medium',
        data: {
          summaryType: 'daily',
          pendingTasks,
          inProgressTasks,
          overdueTasks,
          date: today.toISOString().slice(0, 10)
        }
      });

      totalNotified++;
    }

    if (totalNotified > 0) {
      console.log(`Daily summary notifications sent: ${totalChecked} users checked, ${totalNotified} summaries sent`);
    }
    return { checked: totalChecked, notified: totalNotified };
  } catch (error) {
    console.error('Error sending daily summaries:', error);
    throw error;
  }
}

module.exports = {
  sendDailySummaries
};
