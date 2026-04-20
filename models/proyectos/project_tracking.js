const mongoose = require("mongoose");

const HistoryEntrySchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["reporte", "hito", "riesgo"],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    impact: { type: String, default: "medio", trim: true },
    status: { type: String, default: "abierto", trim: true },
    dueDate: { type: Date, default: null },
    createdBy: { type: String, default: "sistema" },
  },
  {
    timestamps: true,
  },
);

const ActivitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    owner: { type: String, default: "", trim: true },
    status: { type: String, default: "pendiente", trim: true },
    progress: { type: Number, default: 0, min: 0, max: 100 },
  },
  {
    timestamps: true,
  },
);

const ValuationItemSchema = new mongoose.Schema(
  {
    pep: { type: String, default: "", trim: true },
    elementoPEP: { type: String, required: true, trim: true },
    nivel: { type: String, default: "", trim: true },
    descripcion: { type: String, default: "", trim: true },
    costo: { type: Number, default: 0 },
    venta: { type: Number, default: 0 },
    real: { type: Number, default: 0 },
    valorizado: { type: Number, default: 0 },
    comentario: { type: String, default: "", trim: true },
  },
  {
    _id: true,
    timestamps: false,
  },
);

const ValuationSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, min: 1 },
    valuationDate: { type: Date, required: true },
    comments: { type: String, default: "", trim: true },
    totalValorizado: { type: Number, default: 0 },
    source: { type: String, enum: ["manual", "excel"], default: "manual" },
    invoiceIssued: { type: Boolean, default: false },
    invoiceNumber: { type: String, default: "", trim: true },
    invoiceIssuedAt: { type: Date, default: null },
    invoiceIssuedBy: { type: String, default: "", trim: true },
    items: { type: [ValuationItemSchema], default: [] },
    createdBy: { type: String, default: "sistema", trim: true },
    updatedBy: { type: String, default: "sistema", trim: true },
  },
  {
    timestamps: true,
  },
);

const ProjectTrackingSchema = new mongoose.Schema(
  {
    pep: { type: String, unique: true, required: true, trim: true },
    projectName: { type: String, default: "", trim: true },
    client: { type: String, default: "", trim: true },
    responsible: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    history: [HistoryEntrySchema],
    activities: [ActivitySchema],
    valuations: { type: [ValuationSchema], default: [] },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("ProjectTracking", ProjectTrackingSchema, "ProjectTracking");
