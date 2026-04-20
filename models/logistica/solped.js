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
    observaciones: String,
    totalEstimado: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['Borrador', 'Pendiente Aprobacion', 'Aprobado', 'Rechazado'],
      default: 'Borrador',
      index: true,
    },
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
