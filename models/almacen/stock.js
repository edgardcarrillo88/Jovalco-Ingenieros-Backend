const mongoose = require('mongoose');

const InventoryStockSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      required: true,
      unique: true,
      index: true,
    },
    cantidad: { type: Number, default: 0, min: 0 },
    montoTotalIngreso: { type: Number, default: 0, min: 0 },
    costoUnitarioActual: { type: Number, default: 0, min: 0 },
    ultimoIngresoAt: { type: Date, default: null },
    ultimoComentario: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('InventoryStock', InventoryStockSchema, 'InventoryStock');
