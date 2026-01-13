const mongoose = require('mongoose');

const DailyReportSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    summary: { type: String, required: true },
    tasks: [{ type: String }],
    status: { type: String, enum: ['pending', 'in-progress', 'done'], default: 'pending' },
    materialName: { type: String },
    quantity: { type: Number, default: 0 },
    location: { type: String },
    panel: { type: String },
    circuit: { type: String },
    notes: { type: String },
    company: { type: String, required: true },
    site: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('DailyReport', DailyReportSchema);

