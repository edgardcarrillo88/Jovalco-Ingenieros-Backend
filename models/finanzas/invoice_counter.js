const mongoose = require('mongoose');

const InvoiceCounterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('InvoiceCounter', InvoiceCounterSchema, 'InvoiceCounter');
