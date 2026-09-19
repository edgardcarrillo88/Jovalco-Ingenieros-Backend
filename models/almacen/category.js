const mongoose = require('mongoose');

/**
 * Categoría de inventario.
 * El costo unitario base NO vive aquí: pertenece al item
 * (`InventoryItem.costoUnitario`), que se sincroniza con el último
 * costo de ingreso registrado.
 */
const InventoryCategorySchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    personalizada: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model('InventoryCategory', InventoryCategorySchema, 'InventoryCategory');
