const mongoose = require('mongoose');

const InventoryItemSchema = new mongoose.Schema(
  {
    codigo: { type: String, trim: true, default: '' },
    nombre: { type: String, required: true, trim: true },
    categoria: { type: String, required: true, trim: true, index: true },
    tipo: {
      type: String,
      enum: ['Componente', 'Fabricado', 'Herramienta'],
      default: 'Componente',
    },
    costoUnitario: { type: Number, default: 0, min: 0 },
    stockSeguridad: { type: Number, default: 0, min: 0 },
    fechaCalibracion: { type: Date, default: null },
    duracionCalibracionMeses: { type: Number, default: 0, min: 0 },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model('InventoryItem', InventoryItemSchema, 'InventoryItem');
