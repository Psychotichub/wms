const mongoose = require('mongoose');

const ContractSchema = new mongoose.Schema(
  {
    materialName: {
      type: String,
      required: true,
      trim: true
    },
    materialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Material',
      required: true
    },
    contractQuantity: {
      type: Number,
      required: true,
      min: 0
    },
    unit: {
      type: String,
      enum: ['pcs', 'm'],
      default: 'pcs'
    },
    company: {
      type: String,
      required: true
    },
    site: {
      type: String,
      required: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

// Ensure one active contract per material per company/site
ContractSchema.index({ materialId: 1, company: 1, site: 1, isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

// Index for efficient queries
ContractSchema.index({ company: 1, site: 1 });
ContractSchema.index({ materialName: 1, company: 1, site: 1 });

module.exports = mongoose.model('Contract', ContractSchema);
