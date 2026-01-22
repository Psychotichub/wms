const express = require('express');
const Received = require('../models/Received');
const DailyReport = require('../models/DailyReport');
const Material = require('../models/Material');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');

const router = express.Router();

// GET /api/inventory - Get all inventory items with consumption data
router.get('/', authenticateToken, requireActiveSite, async (req, res, next) => {
  try {
    const { company, site } = req.user;

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

    // Get all materials to get unit information
    const allMaterials = await Material.find({ company, site }).select('name unit').lean();
    const materialMap = new Map(allMaterials.map(m => [m.name.toLowerCase(), m]));

    // Calculate inventory for each material
    const inventoryItems = await Promise.all(
      receivedMaterials.map(async ({ _id: materialName, totalReceived }) => {
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
        const stock = totalReceived - totalConsumption;

        // Determine status
        let status = 'OK';
        if (totalConsumption > totalReceived) {
          status = 'Exceed';
        } else if (totalConsumption === totalReceived) {
          status = 'Finished';
        }

        const material = materialMap.get(materialName.toLowerCase());
        const unit = material?.unit || 'pcs';

        return {
          materialName,
          received: totalReceived,
          totalConsumption,
          stock,
          status,
          unit
        };
      })
    );

    res.json({
      inventory: inventoryItems,
      success: true
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
