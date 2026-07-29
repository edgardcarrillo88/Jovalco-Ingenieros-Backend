const mongoose = require('mongoose');

const SeguridadCatalogoSchema = new mongoose.Schema({
  tipoCat: {
    type: String,
    enum: ['tipoExamen', 'tipoCertificacion', 'tipoCapacitacion', 'tipoEvento', 'criticidad', 'estadoEvento', 'tipoEPP'],
    required: true,
    index: true,
  },
  valor: { type: String, required: true },
  orden: { type: Number, default: 0 },
}, { timestamps: true });

SeguridadCatalogoSchema.index({ tipoCat: 1, valor: 1 }, { unique: true });

module.exports = mongoose.model('SeguridadCatalogo', SeguridadCatalogoSchema, 'SeguridadCatalogo');
