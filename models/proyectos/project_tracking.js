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

const ProjectTrackingSchema = new mongoose.Schema(
  {
    pep: { type: String, unique: true, required: true, trim: true },
    projectName: { type: String, default: "", trim: true },
    client: { type: String, default: "", trim: true },
    responsible: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    history: [HistoryEntrySchema],
    activities: [ActivitySchema],
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("ProjectTracking", ProjectTrackingSchema, "ProjectTracking");
