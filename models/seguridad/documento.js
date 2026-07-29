const mongoose = require('mongoose');

const SeguridadDocumentoSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  categoria: {
    type: String,
    enum: ['Exámenes médicos', 'Certificaciones', 'Capacitaciones', 'Otros'],
    required: true,
  },
  descripcion: { type: String, default: '', trim: true },
  activo: { type: Boolean, default: true },
  deleted: { type: Boolean, default: false },
}, { timestamps: true });

SeguridadDocumentoSchema.index({ nombre: 1, deleted: false });
SeguridadDocumentoSchema.index({ categoria: 1, activo: 1 });

module.exports = mongoose.model('SeguridadDocumento', SeguridadDocumentoSchema, 'SeguridadDocumento');
