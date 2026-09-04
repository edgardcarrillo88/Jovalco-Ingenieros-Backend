const TimesheetModel = require('../../../models/equipo/timesheet');
const ComercialModel = require('../../../models/comercial/comercial');
const { isEquipoApprover } = require('../../../services/v1/seguridad/userService');
const mongoose = require('mongoose');

// AUTH_BYPASS elimina la autorización por aprobadores (solo para desarrollo puntual).
const AUTH_BYPASS = false;

// El aprobador se determina consultando la colección User por email.
// Ya no se usa TIMESHEET_APPROVER_EMAILS ni SOLPED_APPROVER_EMAILS.
const isApprover = async (email) => {
  if (AUTH_BYPASS) return true;
  return isEquipoApprover(email);
};

/**
 * Obtiene el email del usuario autenticado.
 * Fuente principal: el token JWT validado (req.user.email). El header
 * x-user-email o el body se usan solo como respaldo (procesos internos).
 */
const getRequesterEmail = (req) =>
  String(
    req.user?.email ||
      req.headers['x-user-email'] ||
      req.body?.requesterEmail ||
      '',
  )
    .trim()
    .toLowerCase();

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const parseDateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toNumber = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const toTitleCaseStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'aprobado') return 'Aprobado';
  if (normalized === 'rechazado') return 'Rechazado';
  if (normalized === 'pendiente aprobacion') return 'Pendiente Aprobacion';
  if (normalized === 'borrador') return 'Borrador';
  return '';
};

const mapEntries = (entries = []) =>
  entries
    .map((entry) => {
      const isMedicalLeave = entry.isMedicalLeave === true;
      const hours = Math.min(24, Math.max(0, toNumber(entry.hours)));
      return {
        hours: isMedicalLeave ? 0 : hours,
        description: String(entry.description || '').trim(),
        pep: String(entry.pep || '').trim(),
        activityDate: parseDateOrNull(entry.activityDate),
        isMedicalLeave,
      };
    })
    .filter((entry) => entry.activityDate);

const validateEntries = (entries = []) => {
  if (!entries.length) {
    return { ok: false, message: 'Debe registrar al menos una fila en el timesheet' };
  }

  for (const entry of entries) {
    if (entry.isMedicalLeave) continue;

    if (!entry.pep) {
      return { ok: false, message: 'Cada fila debe incluir un PEP' };
    }
    if (!entry.description) {
      return { ok: false, message: 'Cada fila debe incluir descripción de actividad' };
    }
    if (entry.hours <= 0) {
      return { ok: false, message: 'Las horas por fila deben ser mayores a 0' };
    }
  }

  return { ok: true };
};

const getPepOptions = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();

    const filter = {
      deleted: { $ne: true },
      Estado: { $regex: '^\\s*adjudicado\\s*$', $options: 'i' },
      PEP: { $exists: true, $ne: '' },
    };

    if (q) {
      filter.$or = [
        { PEP: { $regex: q, $options: 'i' } },
        { Descripcion: { $regex: q, $options: 'i' } },
        { Cliente: { $regex: q, $options: 'i' } },
      ];
    }

    const rows = await ComercialModel.find(filter)
      .select('PEP Descripcion Cliente')
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();

    const data = rows.map((row) => ({
      pep: String(row.PEP || '').trim(),
      descripcion: String(row.Descripcion || '').trim(),
      cliente: String(row.Cliente || '').trim(),
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getPepOptions] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener PEPs para timesheet' });
  }
};

const createTimesheet = async (req, res) => {
  try {
    const requesterEmail = getRequesterEmail(req);
    if (!requesterEmail) {
      return res.status(400).json({ success: false, message: 'Email del colaborador requerido' });
    }

    const entries = mapEntries(req.body.entries || []);
    const validation = validateEntries(entries);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const totalHours = entries.reduce((acc, entry) => acc + toNumber(entry.hours), 0);
    const status = req.body.submit === true ? 'Pendiente Aprobacion' : 'Borrador';

    const row = new TimesheetModel({
      requesterEmail,
      requesterName: String(req.body.requesterName || '').trim(),
      totalHours,
      status,
      entries,
      submittedAt: status === 'Pendiente Aprobacion' ? new Date() : null,
    });

    const saved = await row.save();

    return res.status(201).json({
      success: true,
      message: status === 'Pendiente Aprobacion' ? 'Timesheet enviado a aprobación' : 'Timesheet guardado en borrador',
      data: saved,
    });
  } catch (error) {
    console.error('[createTimesheet] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al crear timesheet' });
  }
};

const updateTimesheet = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID de timesheet inválido' });
    }

    const requesterEmail = getRequesterEmail(req);

    const row = await TimesheetModel.findOne({ _id: id, deleted: false });
    if (!row) {
      return res.status(404).json({ success: false, message: 'Timesheet no encontrado' });
    }

    if (!AUTH_BYPASS && !(await isApprover(requesterEmail)) && row.requesterEmail !== requesterEmail) {
      return res.status(403).json({ success: false, message: 'No autorizado para editar este timesheet' });
    }

    if (row.status === 'Aprobado') {
      return res.status(400).json({ success: false, message: 'No se puede editar un timesheet aprobado' });
    }

    const entries = mapEntries(req.body.entries || []);
    const validation = validateEntries(entries);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const totalHours = entries.reduce((acc, entry) => acc + toNumber(entry.hours), 0);
    const status = req.body.submit === true ? 'Pendiente Aprobacion' : 'Borrador';

    row.entries = entries;
    row.totalHours = totalHours;
    row.status = status;
    row.requesterName = String(req.body.requesterName || row.requesterName || '').trim();
    row.submittedAt = status === 'Pendiente Aprobacion' ? new Date() : null;

    if (status !== 'Pendiente Aprobacion') {
      row.approvedAt = null;
      row.approvedBy = '';
      row.rejectedAt = null;
      row.rejectedBy = '';
      row.approvalComment = '';
    }

    const saved = await row.save();

    return res.status(200).json({
      success: true,
      message: status === 'Pendiente Aprobacion' ? 'Timesheet actualizado y enviado a aprobación' : 'Timesheet actualizado',
      data: saved,
    });
  } catch (error) {
    console.error('[updateTimesheet] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar timesheet' });
  }
};

const getTimesheets = async (req, res) => {
  try {
    const email = getRequesterEmail(req) || String(req.query.email || '').trim().toLowerCase();
    const mine = String(req.query.mine || 'false').toLowerCase() === 'true';
    const status = toTitleCaseStatus(req.query.status);
    const pep = String(req.query.pep || '').trim();
    const from = parseDateOrNull(req.query.from);
    const to = parseDateOrNull(req.query.to);

    const filter = { deleted: false };

    if (!AUTH_BYPASS && (!(await isApprover(email)) || mine)) {
      filter.requesterEmail = email;
    }

    if (status) {
      filter.status = status;
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }

    if (pep) {
      filter['entries.pep'] = { $regex: pep, $options: 'i' };
    }

    const rows = await TimesheetModel.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[getTimesheets] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener timesheets' });
  }
};

const getApprovalQueue = async (req, res) => {
  try {
    const email = getRequesterEmail(req);

    if (!AUTH_BYPASS && !(await isApprover(email))) {
      return res.status(403).json({ success: false, message: 'No autorizado para aprobar timesheets' });
    }

    const rows = await TimesheetModel.find({
      deleted: false,
      status: 'Pendiente Aprobacion',
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[getApprovalQueue] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener cola de aprobación de timesheets' });
  }
};

const approveTimesheet = async (req, res) => {
  try {
    const email = getRequesterEmail(req);

    if (!AUTH_BYPASS && !(await isApprover(email))) {
      return res.status(403).json({ success: false, message: 'No autorizado para aprobar timesheets' });
    }

    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID de timesheet inválido' });
    }

    const action = String(req.body.action || '').trim().toLowerCase();
    const comment = String(req.body.comment || '').trim();

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Acción inválida' });
    }

    const update =
      action === 'approve'
        ? {
            status: 'Aprobado',
            approvedBy: email,
            approvedAt: new Date(),
            approvalComment: comment,
            rejectedBy: '',
            rejectedAt: null,
          }
        : {
            status: 'Rechazado',
            rejectedBy: email,
            rejectedAt: new Date(),
            approvalComment: comment,
            approvedBy: '',
            approvedAt: null,
          };

    const row = await TimesheetModel.findOneAndUpdate(
      { _id: id, status: 'Pendiente Aprobacion', deleted: false },
      update,
      { new: true },
    );

    if (!row) {
      return res.status(404).json({ success: false, message: 'Timesheet no encontrado o ya procesado' });
    }

    return res.status(200).json({
      success: true,
      message: action === 'approve' ? 'Timesheet aprobado' : 'Timesheet rechazado',
      data: row,
    });
  } catch (error) {
    console.error('[approveTimesheet] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al procesar aprobación' });
  }
};

const getDashboard = async (req, res) => {
  try {
    const email = getRequesterEmail(req);
    const approver = AUTH_BYPASS ? true : await isApprover(email);

    const filter = { deleted: false };
    if (!approver) {
      filter.requesterEmail = email;
    }

    const rows = await TimesheetModel.find(filter)
      .select('requesterEmail requesterName totalHours status entries createdAt')
      .lean();

    const statusBuckets = rows.reduce(
      (acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      },
      {
        Borrador: 0,
        'Pendiente Aprobacion': 0,
        Aprobado: 0,
        Rechazado: 0,
      },
    );

    const totalHours = rows.reduce((acc, row) => acc + toNumber(row.totalHours), 0);
    const approvedHours = rows
      .filter((row) => row.status === 'Aprobado')
      .reduce((acc, row) => acc + toNumber(row.totalHours), 0);
    const pendingHours = rows
      .filter((row) => row.status === 'Pendiente Aprobacion')
      .reduce((acc, row) => acc + toNumber(row.totalHours), 0);

    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        mes: date.toLocaleDateString('es-PE', { month: 'short' }),
        reportadas: 0,
        aprobadas: 0,
      };
    });

    const monthMap = new Map(months.map((m) => [m.key, m]));
    const pepHoursMap = new Map();
    const collaboratorHoursMap = new Map();
    let medicalLeaveCount = 0;

    rows.forEach((row) => {
      const createdAt = new Date(row.createdAt);
      const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      const target = monthMap.get(key);

      if (target) {
        target.reportadas += toNumber(row.totalHours);
        if (row.status === 'Aprobado') {
          target.aprobadas += toNumber(row.totalHours);
        }
      }

      const collaboratorKey = String(row.requesterName || row.requesterEmail || 'Sin nombre').trim();
      collaboratorHoursMap.set(collaboratorKey, (collaboratorHoursMap.get(collaboratorKey) || 0) + toNumber(row.totalHours));

      (row.entries || []).forEach((entry) => {
        const pep = String(entry.pep || '').trim();
        if (pep) {
          pepHoursMap.set(pep, (pepHoursMap.get(pep) || 0) + toNumber(entry.hours));
        }
        if (entry.isMedicalLeave === true) {
          medicalLeaveCount += 1;
        }
      });
    });

    const topPep = Array.from(pepHoursMap.entries())
      .map(([pep, horas]) => ({ pep, horas }))
      .sort((a, b) => b.horas - a.horas)
      .slice(0, 8);

    const teamHours = Array.from(collaboratorHoursMap.entries())
      .map(([nombre, horas]) => ({ nombre, horas }))
      .sort((a, b) => b.horas - a.horas)
      .slice(0, 8);

    const avgHoursPerTimesheet = rows.length > 0 ? totalHours / rows.length : 0;

    return res.status(200).json({
      success: true,
      data: {
        totalTimesheets: rows.length,
        totalHours,
        approvedHours,
        pendingHours,
        statusBuckets,
        monthlySeries: months,
        topPep,
        teamHours,
        medicalLeaveCount,
        avgHoursPerTimesheet,
      },
    });
  } catch (error) {
    console.error('[getDashboard] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener dashboard de equipo' });
  }
};

module.exports = {
  getPepOptions,
  createTimesheet,
  updateTimesheet,
  getTimesheets,
  getApprovalQueue,
  approveTimesheet,
  getDashboard,
};
