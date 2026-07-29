const mongoose = require('mongoose');

const InventoryCategorySchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    costoUnitario: { type: Number, default: 0, min: 0 },
    personalizada: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model('InventoryCategory', InventoryCategorySchema, 'InventoryCategory');
