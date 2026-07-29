const mongoose = require('mongoose');

const CumplimientoItemSchema = new mongoose.Schema({
  documentoId: { type: mongoose.Schema.Types.ObjectId, ref: 'SeguridadDocumento', required: true },
  nombreDoc: { type: String, default: '' },
  estado: { type: String, enum: ['Pendiente', 'Vigente', 'Próximo a vencer', 'Vencido', 'NA'], default: 'Pendiente' },
  fechaRealizacion: { type: Date, default: null },
  fechaVencimiento: { type: Date, default: null },
  documentoAdjunto: { type: String, default: '' },
  observaciones: { type: String, default: '' },
}, { _id: false });

const SeguridadChecklistCumplimientoSchema = new mongoose.Schema({
  personalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Personal', required: true },
  pep: { type: String, required: true },
  items: [CumplimientoItemSchema],
  porcentaje: { type: Number, default: 0 },
}, { timestamps: true });

SeguridadChecklistCumplimientoSchema.index({ pep: 1, personalId: 1 }, { unique: true });

module.exports = mongoose.model('SeguridadChecklistCumplimiento', SeguridadChecklistCumplimientoSchema, 'SeguridadChecklistCumplimiento');
