const mongoose = require('mongoose');

const TimesheetEntrySchema = new mongoose.Schema(
  {
    hours: { type: Number, default: 0, min: 0, max: 24 },
    description: { type: String, default: '', trim: true },
    pep: { type: String, default: '', trim: true },
    activityDate: { type: Date, required: true },
    isMedicalLeave: { type: Boolean, default: false },
  },
  { _id: false },
);

const TimesheetSchema = new mongoose.Schema(
  {
    requesterName: { type: String, default: '', trim: true },
    requesterEmail: { type: String, required: true, trim: true, lowercase: true },
    totalHours: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['Borrador', 'Pendiente Aprobacion', 'Aprobado', 'Rechazado'],
      default: 'Borrador',
    },
    entries: { type: [TimesheetEntrySchema], default: [] },
    deleted: { type: Boolean, default: false },
    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: String, default: '' },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: '' },
    approvalComment: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Timesheet', TimesheetSchema, 'Timesheet');
