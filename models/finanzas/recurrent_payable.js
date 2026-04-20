const mongoose = require('mongoose');

const RecurrentPayableSchema = new mongoose.Schema(
  {
    concept: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    provider: { type: String, default: '', trim: true },
    pep: { type: String, default: '', trim: true },
    accountingClass: { type: String, default: 'OTHER', index: true },
    accountingCategory: { type: String, default: '', trim: true, index: true },
    accountingSubcategory: { type: String, default: '', trim: true },
    costCenter: { type: String, default: '', trim: true, index: true },
    loanComponent: {
      type: String,
      enum: ['NONE', 'CAPITAL', 'INTEREST'],
      default: 'NONE',
    },
    accountingUpdatedBy: { type: String, default: 'sistema', trim: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'PEN', trim: true },
    frequency: {
      type: String,
      enum: ['Mensual', 'Bimestral', 'Trimestral', 'Semestral', 'Anual'],
      default: 'Mensual',
    },
    paymentReferenceDay: { type: Number, min: 1, max: 31, required: true },
    isActive: { type: Boolean, default: true, index: true },
    nextDueDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['Pendiente', 'Programado', 'Parcial', 'Pagado'],
      default: 'Pendiente',
      index: true,
    },
    paidAmount: { type: Number, default: 0 },
    notes: { type: String, default: '', trim: true },
    paymentReference: { type: String, default: '', trim: true },
    paidAt: { type: Date, default: null },
    paymentHistory: [
      {
        _id: false,
        paymentDate: { type: Date, default: Date.now },
        amount: { type: Number, default: 0 },
        reference: { type: String, default: '', trim: true },
        statusAfter: {
          type: String,
          enum: ['Pendiente', 'Programado', 'Parcial', 'Pagado'],
          default: 'Pendiente',
        },
        accountingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
        overrideApplied: { type: Boolean, default: false },
        overrideReason: { type: String, default: '' },
        overrideBy: { type: String, default: '' },
        registeredBy: { type: String, default: 'sistema', trim: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    createdBy: { type: String, default: 'sistema', trim: true },
    updatedBy: { type: String, default: 'sistema', trim: true },
    deleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('RecurrentPayable', RecurrentPayableSchema, 'RecurrentPayable');
