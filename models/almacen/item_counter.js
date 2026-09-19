const mongoose = require('mongoose');

/**
 * Contador secuencial para la generación automática de códigos de material.
 * Mismo patrón que Comercial_Counter y Logistica_Solped_Counter: el incremento
 * se realiza de forma atómica con findOneAndUpdate para evitar duplicados.
 */
const InventoryItemCounterSchema = mongoose.Schema({
  name: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model(
  'InventoryItemCounter',
  InventoryItemCounterSchema,
  'InventoryItemCounter',
);
