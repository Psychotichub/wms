const express = require('express');
const Contract = require('../models/Contract');
const Material = require('../models/Material');
const DailyReport = require('../models/DailyReport');
const { authenticateToken, requireActiveSite, requireAdmin } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');
const { checkAndNotifyExceededContracts } = require('../utils/contractNotifications');

const router = express.Router();

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const contractCreateSchema = z.object({
  materialId: z.string().min(1),
  contractQuantity: z.union([z.number(), z.string()]),
  unit: z.enum(['pcs', 'm']).optional()
});

const contractUpdateSchema = z.object({
  contractQuantity: z.union([z.number(), z.string()]).optional(),
  unit: z.enum(['pcs', 'm']).optional(),
  isActive: z.union([z.boolean(), z.string()]).optional()
});

// GET /api/contracts - Get all contracts with consumption data
router.get('/', authenticateToken, requireActiveSite, async (req, res, next) => {
  try {
    const query = {
      company: req.user.company,
      site: req.user.site,
      isActive: true
    };

    const contracts = await Contract.find(query)
      .populate('materialId', 'name unit')
      .sort({ materialName: 1 })
      .lean();

    // Calculate consumption for each contract
    const contractsWithConsumption = await Promise.all(
      contracts.map(async (contract) => {
        // Sum all quantities from daily reports for this material
        const consumptionResult = await DailyReport.aggregate([
          {
            $match: {
              company: req.user.company,
              site: req.user.site,
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
        const restQuantity = contract.contractQuantity - totalConsumption;

        // Determine status
        let status = 'OK';
        if (totalConsumption > contract.contractQuantity) {
          status = 'Exceed';
        } else if (totalConsumption === contract.contractQuantity) {
          status = 'Finished';
        }

        return {
          id: contract._id,
          materialId: contract.materialId?._id || contract.materialId,
          materialName: contract.materialName,
          contractQuantity: contract.contractQuantity,
          unit: contract.unit || contract.materialId?.unit || 'pcs',
          totalConsumption,
          restQuantity,
          status,
          createdAt: contract.createdAt,
          updatedAt: contract.updatedAt
        };
      })
    );

    res.json({
      contracts: contractsWithConsumption,
      success: true
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/contracts - Create new contract
router.post('/', authenticateToken, requireActiveSite, requireAdmin, validate(contractCreateSchema), async (req, res, next) => {
  try {
    const { materialId, contractQuantity, unit } = req.data;

    // Verify material exists
    const material = await Material.findOne({
      _id: materialId,
      company: req.user.company,
      site: req.user.site
    });

    if (!material) {
      return res.status(400).json({
        error: 'Material not found',
        success: false
      });
    }

    // Check if active contract already exists for this material
    const existingContract = await Contract.findOne({
      materialId,
      company: req.user.company,
      site: req.user.site,
      isActive: true
    });

    if (existingContract) {
      return res.status(400).json({
        error: 'Active contract already exists for this material',
        success: false
      });
    }

    const contract = await Contract.create({
      materialId,
      materialName: material.name,
      contractQuantity: Number(contractQuantity),
      unit: unit || material.unit || 'pcs',
      company: req.user.company,
      site: req.user.site,
      createdBy: req.user.id
    });

    res.status(201).json({
      contract: {
        id: contract._id,
        materialId: contract.materialId,
        materialName: contract.materialName,
        contractQuantity: contract.contractQuantity,
        unit: contract.unit
      },
      success: true,
      message: 'Contract created successfully'
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        error: 'Active contract already exists for this material',
        success: false
      });
    }
    return next(err);
  }
});

// PUT /api/contracts/:id - Update contract
router.put('/:id', authenticateToken, requireActiveSite, requireAdmin, validate(idParamsSchema, { source: 'params' }), validate(contractUpdateSchema), async (req, res, next) => {
  try {
    const { contractQuantity, unit, isActive } = req.data;

    const updateData = {};
    if (contractQuantity !== undefined) updateData.contractQuantity = Number(contractQuantity);
    if (unit !== undefined) updateData.unit = unit;
    if (isActive !== undefined) updateData.isActive = isActive === true || isActive === 'true';

    const contract = await Contract.findOneAndUpdate(
      {
        _id: req.params.id,
        company: req.user.company,
        site: req.user.site
      },
      updateData,
      { new: true }
    ).populate('materialId', 'name unit');

    if (!contract) {
      return res.status(404).json({
        error: 'Contract not found',
        success: false
      });
    }

    res.json({
      contract: {
        id: contract._id,
        materialId: contract.materialId,
        materialName: contract.materialName,
        contractQuantity: contract.contractQuantity,
        unit: contract.unit,
        isActive: contract.isActive
      },
      success: true,
      message: 'Contract updated successfully'
    });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/contracts/:id - Delete contract (soft delete by setting isActive to false)
router.delete('/:id', authenticateToken, requireActiveSite, requireAdmin, validate(idParamsSchema, { source: 'params' }), async (req, res, next) => {
  try {
    const contract = await Contract.findOneAndUpdate(
      {
        _id: req.params.id,
        company: req.user.company,
        site: req.user.site
      },
      { isActive: false },
      { new: true }
    );

    if (!contract) {
      return res.status(404).json({
        error: 'Contract not found',
        success: false
      });
    }

    res.json({
      success: true,
      message: 'Contract deactivated successfully'
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/contracts/check-exceeded - Manual trigger for checking exceeded contracts (for testing or cron jobs)
// This endpoint can be called by a cron job 2 times per day
router.post('/check-exceeded', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const result = await checkAndNotifyExceededContracts();
    res.json({
      success: true,
      message: 'Contract exceed check completed',
      result
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
