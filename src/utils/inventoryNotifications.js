const Received = require('../models/Received');
const DailyReport = require('../models/DailyReport');
const User = require('../models/User');
const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');

/**
 * Check for inventory items that have exceeded their received quantity and send notifications
 * This should be called 2 times per day (e.g., via cron job)
 */
async function checkAndNotifyExceededInventory() {
  try {
    // Get all companies and sites
    const companies = await Received.distinct('company');
    if (companies.length === 0) {
      console.log('No received records found');
      return { checked: 0, notified: 0 };
    }

    let totalChecked = 0;
    let totalNotified = 0;

    // Process each company/site combination
    for (const company of companies) {
      const sites = await Received.distinct('site', { company });
      
      for (const site of sites) {
        // Get all unique materials that have received records
        const receivedMaterials = await Received.aggregate([
          {
            $match: { company, site }
          },
          {
            $group: {
              _id: '$materialName',
              totalReceived: { $sum: '$quantity' }
            }
          }
        ]);

        if (receivedMaterials.length === 0) continue;

        // Get all users for this organization
        const users = await User.find({ company, site }).select('_id').lean();
        if (users.length === 0) continue;

        const userIds = users.map(u => u._id.toString());

        // Check each material for exceed status
        for (const { _id: materialName, totalReceived } of receivedMaterials) {
          totalChecked++;

          // Calculate total consumption from daily reports
          const consumptionResult = await DailyReport.aggregate([
            {
              $match: {
                company,
                site,
                materialName
              }
            },
            {
              $group: {
                _id: null,
                totalConsumption: { $sum: { $ifNull: ['$quantity', 0] } }
              }
            }
          ]);

          const totalConsumption = consumptionResult.length > 0 ? consumptionResult[0].totalConsumption : 0;

          // Check if exceeded (consumption > received)
          if (totalConsumption > totalReceived) {
            // Check notification count for today (allow max 2 notifications per day)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const endOfDay = new Date(today);
            endOfDay.setDate(endOfDay.getDate() + 1);

            // Send notification to all users
            for (const userId of userIds) {
              try {
                // Count how many times we've notified today for this material (max 2 per day)
                const notificationCount = await Notification.countDocuments({
                  recipient: userId,
                  type: 'inventory_exceeded',
                  'data.materialName': materialName,
                  createdAt: { $gte: today, $lt: endOfDay }
                });

                if (notificationCount >= 2) {
                  continue; // Skip if already notified 2 times today
                }

                const excessAmount = totalConsumption - totalReceived;

                await NotificationPreferences.sendNotificationIfAllowed(userId, {
                  recipient: userId,
                  title: 'Inventory Exceeded',
                  message: `${materialName} consumption (${totalConsumption} pcs) has exceeded the received quantity (${totalReceived} pcs) by ${excessAmount} pcs.`,
                  type: 'inventory_exceeded',
                  priority: 'high',
                  data: {
                    materialName,
                    received: totalReceived,
                    totalConsumption,
                    excessAmount,
                    stock: totalReceived - totalConsumption
                  }
                });

                totalNotified++;
              } catch (error) {
                console.error(`Failed to send notification to user ${userId}:`, error);
              }
            }
          }
        }
      }
    }

    console.log(`Inventory exceed check completed: ${totalChecked} materials checked, ${totalNotified} notifications sent`);
    return { checked: totalChecked, notified: totalNotified };
  } catch (error) {
    console.error('Error checking exceeded inventory:', error);
    throw error;
  }
}

module.exports = {
  checkAndNotifyExceededInventory
};
