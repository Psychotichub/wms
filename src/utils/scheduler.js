const cron = require('node-cron');
const { checkAndNotifyExceededContracts } = require('./contractNotifications');
const { checkAndNotifyExceededInventory } = require('./inventoryNotifications');

/**
 * Initialize scheduled jobs
 * Runs contract exceed check 2 times per day:
 * - 9:00 AM (09:00)
 * - 6:00 PM (18:00)
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

  console.log('[Scheduler] Contract exceed check scheduled to run at 9:00 AM and 6:00 PM daily (UTC)');
  console.log('[Scheduler] Inventory exceed check scheduled to run at 9:00 AM and 6:00 PM daily (UTC)');
}

module.exports = {
  initializeScheduledJobs
};
