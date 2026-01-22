const Contract = require('../models/Contract');
const DailyReport = require('../models/DailyReport');
const User = require('../models/User');
const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');

/**
 * Check for contracts that have exceeded their quantity and send notifications
 * This should be called 2 times per day (e.g., via cron job)
 */
async function checkAndNotifyExceededContracts() {
  try {
    // Get all active contracts grouped by company/site
    const contracts = await Contract.find({ isActive: true })
      .populate('materialId', 'name unit')
      .lean();

    if (contracts.length === 0) {
      console.log('No active contracts found');
      return { checked: 0, notified: 0 };
    }

    // Group contracts by company/site
    const contractsByOrg = {};
    for (const contract of contracts) {
      const key = `${contract.company}:${contract.site}`;
      if (!contractsByOrg[key]) {
        contractsByOrg[key] = [];
      }
      contractsByOrg[key].push(contract);
    }

    let totalChecked = 0;
    let totalNotified = 0;

    // Process each organization
    for (const [orgKey, orgContracts] of Object.entries(contractsByOrg)) {
      const [company, site] = orgKey.split(':');

      // Get all users for this organization
      const users = await User.find({ company, site }).select('_id').lean();
      if (users.length === 0) continue;

      const userIds = users.map(u => u._id.toString());

      // Check each contract for exceed status
      for (const contract of orgContracts) {
        totalChecked++;

        // Calculate total consumption from daily reports
        const consumptionResult = await DailyReport.aggregate([
          {
            $match: {
              company,
              site,
              materialName: contract.materialName
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

        // Check if exceeded
        if (totalConsumption > contract.contractQuantity) {
          // Check notification count for today (allow max 2 notifications per day)
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const endOfDay = new Date(today);
          endOfDay.setDate(endOfDay.getDate() + 1);

          // Send notification to all users
          for (const userId of userIds) {
            try {
              // Count how many times we've notified today for this contract (max 2 per day)
              const notificationCount = await Notification.countDocuments({
                recipient: userId,
                type: 'contract_exceeded',
                'data.contractId': contract._id.toString(),
                createdAt: { $gte: today, $lt: endOfDay }
              });

              if (notificationCount >= 2) {
                continue; // Skip if already notified 2 times today
              }

              const excessAmount = totalConsumption - contract.contractQuantity;
              const materialName = contract.materialName || contract.materialId?.name || 'Material';

              await NotificationPreferences.sendNotificationIfAllowed(userId, {
                recipient: userId,
                title: 'Contract Quantity Exceeded',
                message: `${materialName} consumption (${totalConsumption} ${contract.unit || 'pcs'}) has exceeded the contract quantity (${contract.contractQuantity} ${contract.unit || 'pcs'}) by ${excessAmount} ${contract.unit || 'pcs'}.`,
                type: 'contract_exceeded',
                priority: 'high',
                data: {
                  contractId: contract._id.toString(),
                  materialName,
                  contractQuantity: contract.contractQuantity,
                  totalConsumption,
                  excessAmount,
                  unit: contract.unit || 'pcs'
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

    console.log(`Contract exceed check completed: ${totalChecked} contracts checked, ${totalNotified} notifications sent`);
    return { checked: totalChecked, notified: totalNotified };
  } catch (error) {
    console.error('Error checking exceeded contracts:', error);
    throw error;
  }
}

module.exports = {
  checkAndNotifyExceededContracts
};
