const Todo = require('../models/Todo');
const Employee = require('../models/Employee');
const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');
const User = require('../models/User');

/**
 * Check for todos with reminders that need to be sent
 * This should be called every 15 minutes or more frequently
 */
async function checkAndNotifyTodoReminders() {
  try {
    const now = new Date();
    let totalChecked = 0;
    let totalNotified = 0;

    // Find all todos with enabled reminders that haven't been notified yet
    // and where the reminder date has passed
    const todos = await Todo.find({
      'reminder.enabled': true,
      'reminder.notified': false,
      'reminder.date': { $lte: now },
      completed: false // Don't send reminders for completed todos
    })
      .populate('employee')
      .lean();

    if (todos.length === 0) {
      return { checked: 0, notified: 0 };
    }

    for (const todo of todos) {
      totalChecked++;

      if (!todo.employee || !todo.user) {
        continue; // Skip todos without valid employee or user
      }

      const employeeId = todo.employee._id || todo.employee;

      // Send notification using NotificationPreferences helper
      // This handles preferences, quiet hours, and push tokens automatically
      const notificationSent = await NotificationPreferences.sendNotificationIfAllowed(employeeId, {
        recipient: employeeId,
        title: 'Todo Reminder',
        message: `Reminder: ${todo.title}`,
        type: 'todo_reminder',
        priority: todo.priority || 'medium',
        relatedEntity: {
          type: 'system',
          id: todo._id
        },
        data: {
          todoId: todo._id.toString(),
          todoTitle: todo.title,
          reminderDate: todo.reminder.date
        }
      });

      if (notificationSent) {
        totalNotified++;

        // Mark reminder as notified
        await Todo.updateOne(
          { _id: todo._id },
          { $set: { 'reminder.notified': true } }
        );
      } else {
        // If notification was not sent (due to preferences), mark as notified to prevent repeated checks
        await Todo.updateOne(
          { _id: todo._id },
          { $set: { 'reminder.notified': true } }
        );
      }
    }

    return {
      checked: totalChecked,
      notified: totalNotified
    };
  } catch (error) {
    console.error('Error checking todo reminders:', error);
    return { checked: 0, notified: 0, error: error.message };
  }
}

module.exports = {
  checkAndNotifyTodoReminders
};
