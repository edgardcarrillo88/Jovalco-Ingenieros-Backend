const mongoose = require('mongoose');

const ExamenMedicoSubSchema = new mongoose.Schema({
  tipo: { type: String, required: true },
  fechaRealizacion: { type: Date, required: true },
  fechaVencimiento: { type: Date, default: null },
  estado: { type: String, enum: ['Vigente', 'Próximo a vencer', 'Vencido'], default: 'Vigente' },
  observaciones: { type: String, default: '' },
  pep: { type: String, default: '' },
}, { _id: false });

const CertificacionSubSchema = new mongoose.Schema({
  tipo: { type: String, required: true },
  fechaEmision: { type: Date, required: true },
  fechaVencimiento: { type: Date, default: null },
  estado: { type: String, enum: ['Vigente', 'Próximo a vencer', 'Vencido'], default: 'Vigente' },
  observaciones: { type: String, default: '' },
  pep: { type: String, default: '' },
}, { _id: false });

const CapacitacionSubSchema = new mongoose.Schema({
  curso: { type: String, required: true },
  tipo: { type: String, default: '' },
  fecha: { type: Date, default: null },
  instructor: { type: String, default: '' },
  horas: { type: Number, default: 0 },
  proyecto: { type: String, default: '' },
  documento: { type: String, default: '' },
  observaciones: { type: String, default: '' },
}, { _id: false });

const EntregaEPPSubSchema = new mongoose.Schema({
  tipoEPP: { type: String, required: true },
  fecha: { type: Date, default: Date.now },
  cantidad: { type: Number, default: 1 },
  responsable: { type: String, default: '' },
  observaciones: { type: String, default: '' },
  pep: { type: String, default: '' },
}, { _id: false });

const SeguridadPersonalSchema = new mongoose.Schema({
  personalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Personal',
    required: true,
    unique: true,
    index: true,
  },
  examenesMedicos: [ExamenMedicoSubSchema],
  certificaciones: [CertificacionSubSchema],
  capacitaciones: [CapacitacionSubSchema],
  entregasEPP: [EntregaEPPSubSchema],
  habilitado: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('SeguridadPersonal', SeguridadPersonalSchema, 'SeguridadPersonal');
