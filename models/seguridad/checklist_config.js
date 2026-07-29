const mongoose = require('mongoose');

const ChecklistItemSchema = new mongoose.Schema({
  documentoId: { type: mongoose.Schema.Types.ObjectId, ref: 'SeguridadDocumento', required: true },
  requerido: { type: Boolean, default: true },
}, { _id: false });

const SeguridadChecklistConfigSchema = new mongoose.Schema({
  pep: { type: String, required: true, unique: true, index: true },
  items: [ChecklistItemSchema],
  personalAsignado: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Personal' }],
}, { timestamps: true });

module.exports = mongoose.model('SeguridadChecklistConfig', SeguridadChecklistConfigSchema, 'SeguridadChecklistConfig');
