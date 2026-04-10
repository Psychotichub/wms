const mongoose = require('mongoose');

const ColumnSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true }
  },
  { _id: false }
);

const RowSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    cells: { type: Map, of: String, default: {} }
  },
  { _id: false }
);

const PanelSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    columns: { type: [ColumnSchema], default: [] },
    rows: { type: [RowSchema], default: [] },
    collapsed: { type: Boolean, default: false }
  },
  { _id: false }
);

const IsolationTestSchema = new mongoose.Schema(
  {
    company: { type: String, required: true },
    site: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    panels: { type: [PanelSchema], default: [] }
  },
  { timestamps: true }
);

IsolationTestSchema.index({ company: 1, site: 1 }, { unique: true });

module.exports = mongoose.model('IsolationTest', IsolationTestSchema);
