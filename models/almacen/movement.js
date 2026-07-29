const mongoose = require('mongoose');

const InventoryMovementSchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      enum: ['INGRESO', 'SALIDA'],
      required: true,
      index: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      required: true,
      index: true,
    },
    cantidad: { type: Number, required: true, min: 0 },
    costoUnitario: { type: Number, default: 0, min: 0 },
    monto: { type: Number, default: 0, min: 0 },
    destino: {
      type: String,
      enum: ['ALMACEN', 'PEP'],
      required: true,
    },
    destinoRef: { type: String, default: 'ALMACEN', trim: true },
    comentarios: { type: String, default: '', trim: true },
    categoria: { type: String, default: '', trim: true },
    usuario: { type: String, default: 'sistema', trim: true },
  },
  { timestamps: true },
);

InventoryMovementSchema.index({ createdAt: -1 });
InventoryMovementSchema.index({ itemId: 1, createdAt: -1 });

module.exports = mongoose.model('InventoryMovement', InventoryMovementSchema, 'InventoryMovement');
