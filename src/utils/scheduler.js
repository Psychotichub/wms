const cron = require('node-cron');
const { checkAndNotifyExceededContracts } = require('./contractNotifications');
const { checkAndNotifyExceededInventory } = require('./inventoryNotifications');
const { checkAndNotifyApproachingDeadlines, checkAndNotifyOverdueDeadlines } = require('./taskDeadlineNotifications');
const { sendDailySummaries } = require('./dailySummaryNotifications');
const Notification = require('../models/Notification');

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
    console.log('[Scheduler] Running contract exceed check...');
    try {
      const result = await checkAndNotifyExceededContracts();
      console.log(`[Scheduler] Contract exceed check completed: ${result.checked} contracts checked, ${result.notified} notifications sent`);
    } catch (error) {
      console.error('[Scheduler] Error running contract exceed check:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC' // Adjust timezone as needed
  });

  // Schedule inventory exceed check at 9:00 AM and 6:00 PM daily
  cron.schedule('0 9,18 * * *', async () => {
    console.log('[Scheduler] Running inventory exceed check...');
    try {
      const result = await checkAndNotifyExceededInventory();
      console.log(`[Scheduler] Inventory exceed check completed: ${result.checked} materials checked, ${result.notified} notifications sent`);
    } catch (error) {
      console.error('[Scheduler] Error running inventory exceed check:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC' // Adjust timezone as needed
  });

  // Schedule deadline approaching check every hour
  // '0 * * * *' means: at minute 0 of every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Running deadline approaching check...');
    try {
      const result = await checkAndNotifyApproachingDeadlines();
      if (result.notified > 0) {
        console.log(`[Scheduler] Deadline approaching check completed: ${result.checked} tasks checked, ${result.notified} notifications sent`);
      }
    } catch (error) {
      console.error('[Scheduler] Error running deadline approaching check:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  // Schedule deadline overdue check every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Running deadline overdue check...');
    try {
      const result = await checkAndNotifyOverdueDeadlines();
      if (result.notified > 0) {
        console.log(`[Scheduler] Deadline overdue check completed: ${result.checked} tasks checked, ${result.notified} notifications sent`);
      }
    } catch (error) {
      console.error('[Scheduler] Error running deadline overdue check:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  // Schedule daily summary check every hour
  // This checks each user's configured time and sends summaries accordingly
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await sendDailySummaries();
      if (result.notified > 0) {
        console.log(`[Scheduler] Daily summary check completed: ${result.checked} users checked, ${result.notified} summaries sent`);
      }
    } catch (error) {
      console.error('[Scheduler] Error sending daily summaries:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  // Process scheduled notifications every 15 minutes
  // This sends notifications that were scheduled for quiet hours or other future times
  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await Notification.processScheduledNotifications();
      if (result.processed > 0) {
        console.log(`[Scheduler] Processed ${result.processed} scheduled notifications`);
      }
    } catch (error) {
      console.error('[Scheduler] Error processing scheduled notifications:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  console.log('[Scheduler] Contract exceed check scheduled to run at 9:00 AM and 6:00 PM daily (UTC)');
  console.log('[Scheduler] Inventory exceed check scheduled to run at 9:00 AM and 6:00 PM daily (UTC)');
  console.log('[Scheduler] Deadline approaching check scheduled to run every hour (UTC)');
  console.log('[Scheduler] Deadline overdue check scheduled to run every hour (UTC)');
  console.log('[Scheduler] Daily summary check scheduled to run every hour (UTC)');
  console.log('[Scheduler] Scheduled notification processor runs every 15 minutes (UTC)');
}

module.exports = {
  initializeScheduledJobs
};
