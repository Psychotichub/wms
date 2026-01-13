const mongoose = require('mongoose');

const ReceivedSchema = new mongoose.Schema(
  {
    materialName: { type: String, required: true },
    quantity: { type: Number, required: true },
    notes: { type: String },
    date: { type: Date, default: Date.now },
    company: { type: String, required: true },
    site: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Received', ReceivedSchema);

