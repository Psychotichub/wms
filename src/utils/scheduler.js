const cron = require('node-cron');
const { checkAndNotifyExceededContracts } = require('./contractNotifications');
const { checkAndNotifyExceededInventory } = require('./inventoryNotifications');
const { checkAndNotifyApproachingDeadlines, checkAndNotifyOverdueDeadlines } = require('./taskDeadlineNotifications');
const { sendDailySummaries } = require('./dailySummaryNotifications');
const { cleanupUnverifiedUsers } = require('./cleanupUnverifiedUsers');
const { checkAndNotifyTodoReminders } = require('./todoReminderNotifications');
const { checkoutStaleAttendance } = require('./staleCheckoutCleanup');
const Notification = require('../models/Notification');
const logger = require('../config/logger').child({ module: 'scheduler' });

/**
 * Initialize scheduled jobs
 * Runs various checks at different intervals:
 * - Contract/Inventory exceed checks: 9:00 AM and 6:00 PM daily
 * - Deadline checks: Every hour
 * - Daily summaries: Every hour (checks user-specific times)
 */
function initializeScheduledJobs() {
  // Schedule contract exceed check at 9:00 AM and 6:00 PM daily
  // Cron format: minute hour day month weekday
  // '0 9,18 * * *' means: at minute 0 of hours 9 and 18, every day
  
  cron.schedule('0 9,18 * * *', async () => {
    logger.info('Running contract exceed check');
    try {
      const result = await checkAndNotifyExceededContracts();
      logger.info({ checked: result.checked, notified: result.notified }, 'Contract exceed check completed');
    } catch (error) {
      logger.error({ err: error }, 'Error running contract exceed check');
    }
  }, { scheduled: true, timezone: 'UTC' });

  cron.schedule('0 9,18 * * *', async () => {
    logger.info('Running inventory exceed check');
    try {
      const result = await checkAndNotifyExceededInventory();
      logger.info({ checked: result.checked, notified: result.notified }, 'Inventory exceed check completed');
    } catch (error) {
      logger.error({ err: error }, 'Error running inventory exceed check');
    }
  }, { scheduled: true, timezone: 'UTC' });

  cron.schedule('0 * * * *', async () => {
    try {
      const result = await checkAndNotifyApproachingDeadlines();
      if (result.notified > 0) {
        logger.info({ checked: result.checked, notified: result.notified }, 'Deadline approaching check completed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error running deadline approaching check');
    }
  }, { scheduled: true, timezone: 'UTC' });

  cron.schedule('0 * * * *', async () => {
    try {
      const result = await checkAndNotifyOverdueDeadlines();
      if (result.notified > 0) {
        logger.info({ checked: result.checked, notified: result.notified }, 'Deadline overdue check completed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error running deadline overdue check');
    }
  }, { scheduled: true, timezone: 'UTC' });

  cron.schedule('0 * * * *', async () => {
    try {
      const result = await sendDailySummaries();
      if (result.notified > 0) {
        logger.info({ checked: result.checked, notified: result.notified }, 'Daily summary check completed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error sending daily summaries');
    }
  }, { scheduled: true, timezone: 'UTC' });

  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await Notification.processScheduledNotifications();
      if (result.processed > 0) {
        logger.info({ processed: result.processed }, 'Processed scheduled notifications');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error processing scheduled notifications');
    }
  }, { scheduled: true, timezone: 'UTC' });

  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await checkAndNotifyTodoReminders();
      if (result.notified > 0) {
        logger.info({ checked: result.checked, notified: result.notified }, 'Todo reminder check completed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error checking todo reminders');
    }
  }, { scheduled: true, timezone: 'UTC' });

  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await cleanupUnverifiedUsers();
      if (result.deleted > 0) {
        logger.info({ checked: result.checked, deleted: result.deleted }, 'Unverified users cleanup completed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error cleaning up unverified users');
    }
  }, { scheduled: true, timezone: 'UTC' });

  // Auto-checkout stale attendance records every 30 minutes
  // Catches users who left without checking out (app killed, GPS lost, outside tracking window, etc.)
  cron.schedule('*/30 * * * *', async () => {
    try {
      const result = await checkoutStaleAttendance();
      if (result.checkedOut > 0) {
        logger.info({ checked: result.checked, checkedOut: result.checkedOut }, 'Stale attendance auto-checkout completed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error running stale attendance checkout');
    }
  }, { scheduled: true, timezone: 'UTC' });

  logger.info('All scheduled jobs initialised');
}

module.exports = {
  initializeScheduledJobs
};
