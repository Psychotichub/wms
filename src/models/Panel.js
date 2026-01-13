const mongoose = require('mongoose');

const PanelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    circuit: { type: String, required: true },
    company: { type: String, required: true },
    site: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

PanelSchema.index({ name: 1, circuit: 1, company: 1, site: 1 }, { unique: true });

const Panel = mongoose.model('Panel', PanelSchema);

// Drop old index (name, company, site) if it exists to allow same panel with different circuits
(async () => {
  try {
    const indexes = await Panel.collection.indexes();
    const obsolete = indexes.find(
      (idx) => idx.key && idx.key.name === 1 && idx.key.company === 1 && idx.key.site === 1 && !idx.key.circuit
    );
    if (obsolete) {
      await Panel.collection.dropIndex(obsolete.name);
    }
  } catch (err) {
    // ignore if collection not ready or index missing
  }
})();

module.exports = Panel;

