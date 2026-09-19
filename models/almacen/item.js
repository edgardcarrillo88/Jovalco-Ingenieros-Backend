const mongoose = require('mongoose');

const InventoryItemSchema = new mongoose.Schema(
  {
    // Código de material autogenerado (MAT-0001) cuando no se informa uno.
    codigo: { type: String, trim: true, default: '', index: true },
    nombre: { type: String, required: true, trim: true },
    categoria: { type: String, required: true, trim: true, index: true },
    tipo: {
      type: String,
      enum: ['Componente', 'Fabricado', 'Herramienta'],
      default: 'Componente',
    },
    // Costo unitario base del item: se actualiza con el último costo de ingreso.
    costoUnitario: { type: Number, default: 0, min: 0 },
    stockSeguridad: { type: Number, default: 0, min: 0 },
    fechaCalibracion: { type: Date, default: null },
    duracionCalibracionMeses: { type: Number, default: 0, min: 0 },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model('InventoryItem', InventoryItemSchema, 'InventoryItem');
