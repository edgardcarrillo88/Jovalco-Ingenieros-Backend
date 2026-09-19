const mongoose = require('mongoose');

/**
 * Lote de inventario: representa UN ingreso concreto de un material.
 *
 * El stock de un material es la suma de sus lotes. Cada lote conserva el costo
 * unitario con el que ingresó y las unidades que le quedan disponibles, de modo
 * que Stock y Kardex puedan mostrar el detalle por costo de ingreso.
 *
 * `cantidad` es lo que ingresó y `cantidadDisponible` lo que aún no se ha
 * retirado. Las salidas descuentan de la cantidadDisponible del lote elegido.
 */
const InventoryBatchSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      required: true,
      index: true,
    },
    // Movimiento de INGRESO que originó este lote.
    movementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryMovement',
      default: null,
    },
    // Código de material vigente (denormalizado para agrupar sin $lookup).
    codigo: { type: String, default: '', trim: true, index: true },
    cantidad: { type: Number, required: true, min: 0 },
    cantidadDisponible: { type: Number, default: 0, min: 0 },
    costoUnitario: { type: Number, default: 0, min: 0 },
    monto: { type: Number, default: 0, min: 0 },
    comentarios: { type: String, default: '', trim: true },
    usuario: { type: String, default: 'sistema', trim: true },
    fechaIngreso: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

InventoryBatchSchema.index({ itemId: 1, fechaIngreso: 1 });
InventoryBatchSchema.index({ codigo: 1, fechaIngreso: 1 });

module.exports = mongoose.model('InventoryBatch', InventoryBatchSchema, 'InventoryBatch');
