const mongoose = require('mongoose');

const SolpedItemSchema = mongoose.Schema(
  {
    posicion: Number,
    pep: String,
    elementoPEP: String,
    material: String,
    descripcion: String,
    cantidad: Number,
    unidad: String,
    precioEstimado: Number,
    // IGV por ítem: indica si el precioEstimado YA incluye IGV (true) o no (false).
    incluyeIGV: { type: Boolean, default: false },
    // Montos calculados por ítem (base sin IGV y monto de IGV).
    importeSinIGV: { type: Number, default: 0 },
    igv: { type: Number, default: 0 },
    almacen: String,
    centro: String,
  },
  { _id: false },
);

const SolpedSchema = mongoose.Schema(
  {
    solpedNumber: { type: String, unique: true, index: true },
    requesterName: String,
    requesterEmail: { type: String, index: true },
    centro: String,
    grupoCompra: String,
    // Moneda de la SOLPED (PEN por defecto). Se propaga a Finanzas.
    moneda: { type: String, enum: ['PEN', 'USD'], default: 'PEN', trim: true, index: true },
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
    observaciones: String,
    // totalEstimado = total a pagar (incluye IGV). Desglose en totalBase/totalIGV.
    totalEstimado: { type: Number, default: 0 },
    totalBase: { type: Number, default: 0 },
    totalIGV: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['Borrador', 'Pendiente Aprobacion', 'Aprobado', 'Rechazado'],
      default: 'Borrador',
      index: true,
    },
    cuentaCargo: {
      type: String,
      enum: ['', 'IBK-SOL', 'IBK-USD', 'CAJA-CHICA'],
      default: '',
    },
    paymentStatus: {
      type: String,
      enum: ['Pendiente', 'Programado', 'Parcial', 'Pagado'],
      default: 'Pendiente',
      index: true,
    },
    source: { type: String, enum: ['MANUAL', 'RECURRENTE'], default: 'MANUAL', index: true },
    recurrentPayableId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    recurrentCycleDate: { type: Date, default: null, index: true },
    recurrentConcept: { type: String, default: '' },
    paidAmount: { type: Number, default: 0 },
    paymentReference: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    paymentHistory: [
      {
        _id: false,
        paymentDate: { type: Date, default: Date.now },
        amount: { type: Number, default: 0 },
        reference: { type: String, default: '' },
        statusAfter: {
          type: String,
          enum: ['Pendiente', 'Programado', 'Parcial', 'Pagado'],
          default: 'Pendiente',
        },
        accountingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
        overrideApplied: { type: Boolean, default: false },
        overrideReason: { type: String, default: '' },
        overrideBy: { type: String, default: '' },
        registeredBy: { type: String, default: 'sistema' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    approvalComment: String,
    approvedBy: String,
    approvedAt: Date,
    rejectedBy: String,
    rejectedAt: Date,
    items: [SolpedItemSchema],
    deleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Solped', SolpedSchema, 'Solped');
