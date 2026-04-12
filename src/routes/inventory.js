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
        const material = materialMap.get(materialName.toLowerCase());
        const consumptionMatch = {
          company,
          site,
          $or: [{ materialName }]
        };
        if (material?._id) {
          consumptionMatch.$or.push({ materialId: material._id });
        }
        const consumptionResult = await DailyReport.aggregate([
          {
            $match: consumptionMatch
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

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    let limit = parseInt(String(req.query.limit ?? '500'), 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 500;
    limit = Math.min(2000, limit);
    const total = inventoryItems.length;
    const start = (page - 1) * limit;
    const slice = inventoryItems.slice(start, start + limit);

    res.json({
      inventory: slice,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0
      },
      success: true
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
