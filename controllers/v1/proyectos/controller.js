const xlsx = require("xlsx");
const ComercialModel = require("../../../models/comercial/comercial");
const ComercialCBSModel = require("../../../models/comercial/comercial_CBS");
const ProjectTrackingModel = require("../../../models/proyectos/project_tracking");
const SolpedModel = require("../../../models/logistica/solped");

const MONTHS_ES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const getUserEmail = (req) =>
  String(req.headers["x-user-email"] || req.body?.userEmail || "sistema").toLowerCase();

const parseDateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toNumber = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getElementoDepth = (pep, elementoPEP) => {
  const pepCode = String(pep || "").trim();
  const elemento = String(elementoPEP || "").trim();

  if (!pepCode || !elemento) return 0;
  if (elemento === pepCode) return 0;
  if (!elemento.startsWith(`${pepCode}.`)) return 0;

  const suffix = elemento.slice(pepCode.length + 1);
  if (!suffix) return 0;
  return suffix.split(".").filter(Boolean).length;
};

const getHierarchyParts = (pep, elementoPEP) => {
  const pepCode = String(pep || "").trim();
  const elemento = String(elementoPEP || "").trim();

  if (!pepCode || !elemento) return [];
  if (elemento === pepCode) return [];
  if (!elemento.startsWith(`${pepCode}.`)) return [];

  const suffix = elemento.slice(pepCode.length + 1);
  return suffix
    .split(".")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
};

const compareHierarchy = (pep, a, b) => {
  const aElemento = String(a.ElementoPEP || "");
  const bElemento = String(b.ElementoPEP || "");

  if (aElemento === pep && bElemento !== pep) return -1;
  if (bElemento === pep && aElemento !== pep) return 1;

  const aParts = getHierarchyParts(pep, aElemento);
  const bParts = getHierarchyParts(pep, bElemento);
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const aValue = aParts[index];
    const bValue = bParts[index];

    if (aValue === undefined && bValue !== undefined) return -1;
    if (bValue === undefined && aValue !== undefined) return 1;
    if (aValue !== bValue) return aValue - bValue;
  }

  if (aParts.length !== bParts.length) return aParts.length - bParts.length;
  return aElemento.localeCompare(bElemento);
};

const getProjects = async (req, res) => {
  try {
    const includeAll = String(req.query.includeAll || "false").toLowerCase() === "true";
    const filter = { deleted: { $ne: true } };

    if (!includeAll) {
      filter.Estado = "Adjudicado";
    }

    const projects = await ComercialModel.find(filter)
      .select(
        "PEP Cliente Descripcion Usuario Correo Estado Monto Moneda FechaInicio FechaRequerida FechaEnvio",
      )
      .sort({ updatedAt: -1 })
      .lean();

    const data = projects.map((project) => ({
      pep: project.PEP,
      nombre: project.Descripcion || "Sin nombre",
      cliente: project.Cliente || "Sin cliente",
      responsable: project.Usuario || project.Correo || "Sin responsable",
      estado: project.Estado || "Sin estado",
      monto: toNumber(project.Monto),
      moneda: project.Moneda || "PEN",
      fechaInicio: project.FechaInicio || null,
      fechaRequerida: project.FechaRequerida || null,
      fechaEnvio: project.FechaEnvio || null,
    }));

    res.status(200).json({ message: "Proyectos obtenidos correctamente", data });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al obtener proyectos" });
  }
};

const getProjectDetail = async (req, res) => {
  try {
    const pep = String(req.params.pep || "").trim();

    if (!pep) {
      return res.status(400).json({ message: "PEP es requerido" });
    }

    const project = await ComercialModel.findOne({
      PEP: pep,
      deleted: { $ne: true },
    }).lean();

    if (!project) {
      return res.status(404).json({ message: "Proyecto no encontrado" });
    }

    const escapedPep = escapeRegExp(pep);

    const structureRowsRaw = await ComercialCBSModel.find({
      deleted: { $ne: true },
      $or: [
        { PEP: { $regex: `^${escapedPep}` } },
        { ElementoPEP: { $regex: `^${escapedPep}` } },
      ],
    })
      .select("PEP ElementoPEP Nivel Descripcion Costo Venta Moneda Carga")
      .sort({ Nivel: 1, ElementoPEP: 1 })
      .lean();

    const approvedSolpeds = await SolpedModel.find({
      deleted: { $ne: true },
      status: "Aprobado",
      "items.pep": pep,
    })
      .select("items")
      .lean();

    const realByElemento = new Map();
    for (const solped of approvedSolpeds) {
      for (const item of solped.items || []) {
        if (String(item.pep || "") !== pep) continue;
        const elemento = String(item.elementoPEP || "").trim();
        if (!elemento) continue;

        const real = toNumber(item.cantidad) * toNumber(item.precioEstimado);
        realByElemento.set(elemento, toNumber(realByElemento.get(elemento)) + real);
      }
    }

    const structureRows = structureRowsRaw
      .map((row) => {
      const elemento = String(row.ElementoPEP || "").trim();
      return {
        ...row,
        Depth: getElementoDepth(pep, elemento),
        Real: toNumber(realByElemento.get(elemento)),
      };
      })
      .sort((a, b) => compareHierarchy(pep, a, b));

    const structureSummaryMap = new Map();
    for (const row of structureRows) {
      const nivel = String(row.Nivel || "N/A");
      const current = structureSummaryMap.get(nivel) || {
        nivel,
        items: 0,
        costo: 0,
        venta: 0,
      };

      current.items += 1;
      current.costo += toNumber(row.Costo);
      current.venta += toNumber(row.Venta);
      structureSummaryMap.set(nivel, current);
    }

    const structureSummary = Array.from(structureSummaryMap.values()).sort(
      (a, b) => Number(a.nivel) - Number(b.nivel),
    );

    const tracking = await ProjectTrackingModel.findOne({ pep }).lean();

    return res.status(200).json({
      message: "Detalle de proyecto obtenido correctamente",
      data: {
        pep,
        nombre: project.Descripcion || "Sin nombre",
        cliente: project.Cliente || "Sin cliente",
        responsable: project.Usuario || project.Correo || "Sin responsable",
        estado: project.Estado || "Sin estado",
        monto: toNumber(project.Monto),
        moneda: project.Moneda || "PEN",
        fechaInicio: project.FechaInicio || null,
        fechaRequerida: project.FechaRequerida || null,
        fechaEnvio: project.FechaEnvio || null,
        estructura: structureRows,
        estructuraResumen: structureSummary,
        historial: (tracking?.history || []).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
        actividades: (tracking?.activities || []).sort(
          (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
        ),
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al obtener detalle del proyecto" });
  }
};

const addHistoryEntry = async (req, res) => {
  try {
    const pep = String(req.params.pep || "").trim();
    const kind = String(req.body.kind || "").trim().toLowerCase();
    const title = String(req.body.title || "").trim();

    if (!pep) return res.status(400).json({ message: "PEP es requerido" });
    if (!kind || !["reporte", "hito", "riesgo"].includes(kind)) {
      return res.status(400).json({ message: "Tipo de historial inválido" });
    }
    if (!title) return res.status(400).json({ message: "Título es requerido" });

    const project = await ComercialModel.findOne({ PEP: pep, deleted: { $ne: true } }).lean();
    if (!project) {
      return res.status(404).json({ message: "Proyecto no encontrado" });
    }

    const entry = {
      kind,
      title,
      description: String(req.body.description || "").trim(),
      impact: String(req.body.impact || "medio").trim().toLowerCase(),
      status: String(req.body.status || "abierto").trim().toLowerCase(),
      dueDate: parseDateOrNull(req.body.dueDate),
      createdBy: getUserEmail(req),
    };

    await ProjectTrackingModel.findOneAndUpdate(
      { pep },
      {
        $setOnInsert: {
          pep,
          projectName: project.Descripcion || "",
          client: project.Cliente || "",
          responsible: project.Usuario || project.Correo || "",
          state: project.Estado || "",
        },
        $push: { history: entry },
      },
      { upsert: true, new: true },
    );

    return res.status(200).json({ message: "Historial registrado correctamente" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al registrar historial" });
  }
};

const addActivity = async (req, res) => {
  try {
    const pep = String(req.params.pep || "").trim();
    const name = String(req.body.name || "").trim();
    const startDate = parseDateOrNull(req.body.startDate);
    const endDate = parseDateOrNull(req.body.endDate);

    if (!pep) return res.status(400).json({ message: "PEP es requerido" });
    if (!name) return res.status(400).json({ message: "Nombre de actividad es requerido" });
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Fechas de actividad inválidas" });
    }
    if (endDate < startDate) {
      return res.status(400).json({ message: "La fecha fin no puede ser menor a inicio" });
    }

    const project = await ComercialModel.findOne({ PEP: pep, deleted: { $ne: true } }).lean();
    if (!project) {
      return res.status(404).json({ message: "Proyecto no encontrado" });
    }

    const activity = {
      name,
      startDate,
      endDate,
      owner: String(req.body.owner || "").trim(),
      status: String(req.body.status || "pendiente").trim().toLowerCase(),
      progress: Math.min(100, Math.max(0, toNumber(req.body.progress))),
    };

    await ProjectTrackingModel.findOneAndUpdate(
      { pep },
      {
        $setOnInsert: {
          pep,
          projectName: project.Descripcion || "",
          client: project.Cliente || "",
          responsible: project.Usuario || project.Correo || "",
          state: project.Estado || "",
        },
        $push: { activities: activity },
      },
      { upsert: true, new: true },
    );

    return res.status(200).json({ message: "Actividad registrada correctamente" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al registrar actividad" });
  }
};

const getDashboard = async (req, res) => {
  try {
    const projects = await ComercialModel.find({ deleted: { $ne: true } })
      .select("PEP Cliente Estado Monto FechaInicio FechaRequerida")
      .lean();

    const peps = projects.map((project) => project.PEP).filter(Boolean);
    const trackingDocs = await ProjectTrackingModel.find({ pep: { $in: peps } }).lean();
    const trackingMap = new Map(trackingDocs.map((doc) => [doc.pep, doc]));

    const totalProjects = projects.length;
    const activeProjects = projects.filter(
      (project) => !["cerrado", "cancelado", "rechazado"].includes(String(project.Estado || "").toLowerCase()),
    ).length;

    const statusBuckets = {};
    const clientBudgetBuckets = {};
    let totalBudget = 0;

    for (const project of projects) {
      const status = String(project.Estado || "Sin estado");
      const client = String(project.Cliente || "Sin cliente");
      const budget = toNumber(project.Monto);

      totalBudget += budget;
      statusBuckets[status] = (statusBuckets[status] || 0) + 1;
      clientBudgetBuckets[client] = (clientBudgetBuckets[client] || 0) + budget;
    }

    let openRisks = 0;
    let criticalRisks = 0;
    let milestoneTotal = 0;
    let milestoneCompliant = 0;
    let scheduleOnTrack = 0;
    let scheduleMeasured = 0;

    const riskByProject = {};
    const monthlyHistoryBuckets = {};

    for (const project of projects) {
      const tracking = trackingMap.get(project.PEP);
      const history = tracking?.history || [];
      const activities = tracking?.activities || [];

      for (const event of history) {
        const kind = String(event.kind || "").toLowerCase();
        const status = String(event.status || "").toLowerCase();
        const impact = String(event.impact || "").toLowerCase();

        const eventDate = parseDateOrNull(event.createdAt) || new Date();
        const monthKey = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, "0")}`;
        monthlyHistoryBuckets[monthKey] = (monthlyHistoryBuckets[monthKey] || 0) + 1;

        if (kind === "riesgo" && !["cerrado", "mitigado", "resuelto"].includes(status)) {
          openRisks += 1;
          riskByProject[project.PEP] = (riskByProject[project.PEP] || 0) + 1;
          if (["alto", "critico"].includes(impact)) {
            criticalRisks += 1;
          }
        }

        if (kind === "hito") {
          milestoneTotal += 1;
          const dueDate = parseDateOrNull(event.dueDate);
          if (status === "completado") {
            if (!dueDate || eventDate <= dueDate) {
              milestoneCompliant += 1;
            }
          }
        }
      }

      for (const activity of activities) {
        const startDate = parseDateOrNull(activity.startDate);
        const endDate = parseDateOrNull(activity.endDate);
        if (!startDate || !endDate || endDate <= startDate) continue;

        const now = new Date();
        const totalMs = endDate.getTime() - startDate.getTime();
        const elapsedMs = Math.min(Math.max(now.getTime() - startDate.getTime(), 0), totalMs);
        const expectedProgress = (elapsedMs / totalMs) * 100;
        const actualProgress = Math.min(100, Math.max(0, toNumber(activity.progress)));

        scheduleMeasured += 1;
        if (actualProgress >= expectedProgress - 10) {
          scheduleOnTrack += 1;
        }
      }
    }

    const milestoneCompliance = milestoneTotal > 0 ? (milestoneCompliant / milestoneTotal) * 100 : 100;
    const scheduleHealth = scheduleMeasured > 0 ? (scheduleOnTrack / scheduleMeasured) * 100 : 100;

    const statusSeries = Object.entries(statusBuckets).map(([name, value]) => ({ name, value }));
    const clientSeries = Object.entries(clientBudgetBuckets)
      .map(([cliente, monto]) => ({ cliente, monto: toNumber(monto) }))
      .sort((a, b) => b.monto - a.monto)
      .slice(0, 7);

    const riskSeries = Object.entries(riskByProject)
      .map(([pep, value]) => ({ pep, value: toNumber(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const monthlySeries = Object.entries(monthlyHistoryBuckets)
      .map(([monthKey, eventos]) => {
        const [year, month] = monthKey.split("-");
        const monthIndex = Number(month) - 1;
        return {
          mes: `${MONTHS_ES[monthIndex]} ${year}`,
          monthKey,
          eventos: toNumber(eventos),
        };
      })
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .slice(-6)
      .map(({ mes, eventos }) => ({ mes, eventos }));

    return res.status(200).json({
      message: "Dashboard de proyectos obtenido correctamente",
      data: {
        totalProjects,
        activeProjects,
        totalBudget,
        atRiskProjects: Object.keys(riskByProject).length,
        criticalRisks,
        milestoneCompliance,
        scheduleHealth,
        statusSeries,
        clientSeries,
        riskSeries,
        monthlySeries,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al obtener dashboard de proyectos" });
  }
};

const DATE_FMT = "yyyy-mm-dd";

const applyDateFormat = (ws, col, rowCount) => {
  for (let r = 2; r <= rowCount + 1; r++) {
    const ref = `${col}${r}`;
    if (ws[ref]) ws[ref].z = DATE_FMT;
  }
};

const downloadGanttTemplate = (req, res) => {
  try {
    const templateRows = [
      { name: "Ingenieria de detalle",       startDate: new Date("2026-05-01"), endDate: new Date("2026-06-30"), owner: "Juan Perez",   status: "Pendiente",   progress: 0  },
      { name: "Adquisicion de materiales",   startDate: new Date("2026-06-01"), endDate: new Date("2026-07-31"), owner: "Maria Garcia", status: "En proceso",  progress: 20 },
    ];

    const ws = xlsx.utils.json_to_sheet(templateRows, {
      header: ["name", "startDate", "endDate", "owner", "status", "progress"],
    });

    applyDateFormat(ws, "B", templateRows.length);
    applyDateFormat(ws, "C", templateRows.length);
    ws["!cols"] = [{ wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 25 }, { wch: 15 }, { wch: 12 }];

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Gantt");
    const buffer = xlsx.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Disposition", "attachment; filename=plantilla_gantt.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.status(200).send(buffer);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Error al generar plantilla" });
  }
};

const bulkUploadActivities = async (req, res) => {
  try {
    const pep = String(req.params.pep || "").trim();
    if (!pep) return res.status(400).json({ message: "PEP es requerido" });
    if (!req.file) return res.status(400).json({ message: "Archivo Excel requerido" });

    const project = await ComercialModel.findOne({ PEP: pep, deleted: { $ne: true } }).lean();
    if (!project) return res.status(404).json({ message: "Proyecto no encontrado" });

    const workbook = xlsx.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false });
    if (!rows.length) return res.status(400).json({ message: "El archivo no tiene filas de datos" });

    const errors = [];
    const activities = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const name = String(row.name || row.Actividad || row.actividad || "").trim();
      const startDate = parseDateOrNull(row.startDate || row.FechaInicio || row.Inicio);
      const endDate = parseDateOrNull(row.endDate || row.FechaFin || row.Fin);
      const progress = Math.min(100, Math.max(0, toNumber(row.progress || row.Progreso || row.progreso)));
      const owner = String(row.owner || row.Responsable || row.responsable || "").trim();
      const status = String(row.status || row.Estado || row.estado || "Pendiente").trim();
      if (!name) { errors.push(`Fila ${rowNum}: campo name vacío`); continue; }
      if (!startDate) { errors.push(`Fila ${rowNum}: fecha inicio inválida`); continue; }
      if (!endDate) { errors.push(`Fila ${rowNum}: fecha fin inválida`); continue; }
      if (endDate < startDate) { errors.push(`Fila ${rowNum}: fecha fin anterior a inicio`); continue; }
      activities.push({ name, startDate, endDate, owner, status, progress });
    }

    if (errors.length && !activities.length) {
      return res.status(400).json({ message: "No se pudo procesar ninguna fila", errors });
    }

    await ProjectTrackingModel.findOneAndUpdate(
      { pep },
      {
        $setOnInsert: { pep, projectName: project.Descripcion || "", client: project.Cliente || "", responsible: project.Usuario || project.Correo || "", state: project.Estado || "" },
        $push: { activities: { $each: activities } },
      },
      { upsert: true, new: true },
    );

    return res.status(200).json({ message: `${activities.length} actividades cargadas correctamente`, loaded: activities.length, errors });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Error al procesar el archivo" });
  }
};

const updateActivity = async (req, res) => {
  try {
    const pep = String(req.params.pep || "").trim();
    const activityId = String(req.params.activityId || "").trim();

    if (!pep) return res.status(400).json({ message: "PEP es requerido" });
    if (!activityId) return res.status(400).json({ message: "ID de actividad requerido" });

    const updateFields = {};
    if (req.body.status !== undefined) {
      updateFields["activities.$.status"] = String(req.body.status).trim().toLowerCase();
    }
    if (req.body.progress !== undefined) {
      updateFields["activities.$.progress"] = Math.min(100, Math.max(0, toNumber(req.body.progress)));
    }

    if (!Object.keys(updateFields).length) {
      return res.status(400).json({ message: "Nada que actualizar" });
    }

    const result = await ProjectTrackingModel.updateOne(
      { pep, "activities._id": activityId },
      { $set: updateFields },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Actividad no encontrada" });
    }

    return res.status(200).json({ message: "Actividad actualizada correctamente" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Error al actualizar actividad" });
  }
};

module.exports = {
  getProjects,
  getProjectDetail,
  addHistoryEntry,
  addActivity,
  updateActivity,
  getDashboard,
  downloadGanttTemplate,
  bulkUploadActivities,
};