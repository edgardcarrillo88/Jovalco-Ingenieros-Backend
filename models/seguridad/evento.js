const mongoose = require('mongoose');

const AccionCorrectivaSchema = new mongoose.Schema({
  accion: { type: String, required: true },
  responsable: { type: String, default: '' },
  fechaCompromiso: { type: Date, default: null },
  estado: { type: String, enum: ['Pendiente', 'En progreso', 'Completada'], default: 'Pendiente' },
  evidencias: { type: String, default: '' },
  comentarios: { type: String, default: '' },
}, { _id: false });

const SeguridadEventoSchema = new mongoose.Schema({
  codigo: { type: String, unique: true, index: true },
  fecha: { type: Date, required: true },
  pep: { type: String, default: '' },
  area: { type: String, default: '' },
  lugar: { type: String, default: '' },
  personalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Personal', default: null },
  tipo: { type: String, required: true },
  descripcion: { type: String, default: '' },
  criticidad: { type: String, enum: ['Baja', 'Media', 'Alta', 'Crítica'], default: 'Media' },
  estado: { type: String, enum: ['Abierto', 'En investigación', 'En tratamiento', 'Cerrado'], default: 'Abierto' },
  evidencias: { type: String, default: '' },
  responsable: { type: String, default: '' },
  accionesCorrectivas: [AccionCorrectivaSchema],
  deleted: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('SeguridadEvento', SeguridadEventoSchema, 'SeguridadEvento');
