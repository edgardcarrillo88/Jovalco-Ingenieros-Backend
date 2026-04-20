const mongoose = require('mongoose');

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    pep: { type: String, required: true, trim: true, index: true },
    projectName: { type: String, default: '', trim: true },
    client: { type: String, default: '', trim: true },
    valuationId: { type: mongoose.Schema.Types.ObjectId, required: true },
    valuationNumber: { type: Number, required: true },
    valuationDate: { type: Date, default: null },
    description: { type: String, default: '', trim: true },
    baseAmount: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    igvApplied: { type: Boolean, default: false },
    igvRate: { type: Number, default: 0 },
    igvAmount: { type: Number, default: 0, min: 0 },
    detraccionApplied: { type: Boolean, default: false },
    detraccionRate: { type: Number, default: 0 },
    detraccionAmount: { type: Number, default: 0, min: 0 },
    netAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'PEN', trim: true },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, default: null },
    notes: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ['Pendiente', 'Cobrado', 'Vencido', 'Anulado'],
      default: 'Pendiente',
      index: true,
    },
    paidDate: { type: Date, default: null },
    createdBy: { type: String, default: 'sistema', trim: true },
    updatedBy: { type: String, default: 'sistema', trim: true },
    deleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Invoice', InvoiceSchema, 'Invoice');
