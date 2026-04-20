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

const isCargaEnabled = (value) => String(value || "").trim().toLowerCase() === "si";

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

const buildTrackingSeed = (pep, project) => ({
  pep,
  projectName: project.Descripcion || "",
  client: project.Cliente || "",
  responsible: project.Usuario || project.Correo || "",
  state: project.Estado || "",
});

const getApprovedRealByElemento = async (pep) => {
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

  return realByElemento;
};

const getProjectStructureData = async (pep) => {
  const project = await ComercialModel.findOne({
    PEP: pep,
    deleted: { $ne: true },
  }).lean();

  if (!project) {
    return null;
  }

  const escapedPep = escapeRegExp(pep);
  const structureRowsRaw = await ComercialCBSModel.find({
    deleted: { $ne: true },
    $or: [{ PEP: { $regex: `^${escapedPep}` } }, { ElementoPEP: { $regex: `^${escapedPep}` } }],
  })
    .select("PEP ElementoPEP Nivel Descripcion Costo Venta Moneda Carga")
    .sort({ Nivel: 1, ElementoPEP: 1 })
    .lean();

  const realByElemento = await getApprovedRealByElemento(pep);

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
  const structureMap = new Map();

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

    const elementoPEP = String(row.ElementoPEP || "").trim();
    if (elementoPEP) {
      structureMap.set(elementoPEP, row);
    }
  }

  const structureSummary = Array.from(structureSummaryMap.values()).sort(
    (a, b) => Number(a.nivel) - Number(b.nivel),
  );

  return {
    project,
    structureRows,
    structureSummary,
    structureMap,
  };
};

const getValorizadoByElemento = (valuations = []) => {
  const valorizadoByElemento = new Map();

  for (const valuation of valuations) {
    for (const item of valuation.items || []) {
      const elemento = String(item.elementoPEP || "").trim();
      if (!elemento) continue;

      valorizadoByElemento.set(
        elemento,
        toNumber(valorizadoByElemento.get(elemento)) + toNumber(item.valorizado),
      );
    }
  }

  return valorizadoByElemento;
};

const getNextValuationNumber = (tracking) => {
  const maxNumber = (tracking?.valuations || []).reduce(
    (acc, valuation) => Math.max(acc, toNumber(valuation.number)),
    0,
  );

  return maxNumber + 1;
};

const serializeValuation = (valuation) => ({
  _id: valuation._id,
  number: toNumber(valuation.number),
  valuationDate: valuation.valuationDate || null,
  comments: valuation.comments || "",
  totalValorizado: toNumber(valuation.totalValorizado),
  source: valuation.source || "manual",
  invoiceIssued: Boolean(valuation.invoiceIssued),
  invoiceNumber: valuation.invoiceNumber || "",
  invoiceIssuedAt: valuation.invoiceIssuedAt || null,
  invoiceIssuedBy: valuation.invoiceIssuedBy || "",
  canEdit: !valuation.invoiceIssued,
  createdBy: valuation.createdBy || "sistema",
  updatedBy: valuation.updatedBy || valuation.createdBy || "sistema",
  createdAt: valuation.createdAt || null,
  updatedAt: valuation.updatedAt || null,
  items: (valuation.items || []).map((item) => ({
    _id: item._id,
    pep: item.pep || "",
    elementoPEP: item.elementoPEP || "",
    nivel: item.nivel || "",
    descripcion: item.descripcion || "",
    costo: toNumber(item.costo),
    venta: toNumber(item.venta),
    real: toNumber(item.real),
    valorizado: toNumber(item.valorizado),
    comentario: item.comentario || "",
  })),
});

const normalizeValuationItems = (items, structureMap, pep) => {
  if (!Array.isArray(items)) {
    return { items: [], errors: ["Debe enviar el detalle de la valorización"] };
  }

  const errors = [];
  const normalized = [];

  items.forEach((rawItem, index) => {
    const elementoPEP = String(
      rawItem?.elementoPEP || rawItem?.ElementoPEP || rawItem?.elementopep || "",
    ).trim();
    const comentario = String(rawItem?.comentario || rawItem?.Comentario || "").trim();
    const valorizado = toNumber(
      rawItem?.valorizado ?? rawItem?.Valorizado ?? rawItem?.valorizadoMonto ?? rawItem?.Monto,
    );

    if (!elementoPEP) {
      errors.push(`Fila ${index + 1}: Elemento PEP es requerido`);
      return;
    }

    const structureRow = structureMap.get(elementoPEP);
    if (!structureRow) {
      errors.push(`Fila ${index + 1}: Elemento PEP ${elementoPEP} no existe en la estructura del proyecto`);
      return;
    }

    const cargaHabilitada = isCargaEnabled(structureRow.Carga);
    if (!cargaHabilitada) {
      if (valorizado !== 0 || comentario) {
        errors.push(
          `Fila ${index + 1}: Elemento PEP ${elementoPEP} no permite valorización porque Carga es distinto de Si`,
        );
      }
      return;
    }

    if (valorizado === 0 && !comentario) {
      return;
    }

    normalized.push({
      pep,
      elementoPEP,
      nivel: String(structureRow.Nivel || "").trim(),
      descripcion: String(structureRow.Descripcion || "").trim(),
      costo: toNumber(structureRow.Costo),
      venta: toNumber(structureRow.Venta),
      real: toNumber(structureRow.Real),
      valorizado,
      comentario,
    });
  });

  if (!normalized.length && !errors.length) {
    errors.push("Debe registrar al menos una fila con monto valorizado o comentario");
  }

  return { items: normalized, errors };
};

const buildValuationPayload = ({ existingValuation, body, items, nextNumber, userEmail, source }) => ({
  number: existingValuation ? toNumber(existingValuation.number) : nextNumber,
  valuationDate: parseDateOrNull(body.valuationDate || body.fechaValorizacion || body.date) || new Date(),
  comments: String(body.comments || body.comentarios || "").trim(),
  totalValorizado: items.reduce((acc, item) => acc + toNumber(item.valorizado), 0),
  source: source || existingValuation?.source || "manual",
  invoiceIssued: Boolean(existingValuation?.invoiceIssued),
  invoiceNumber: String(existingValuation?.invoiceNumber || "").trim(),
  invoiceIssuedAt: existingValuation?.invoiceIssuedAt || null,
  invoiceIssuedBy: String(existingValuation?.invoiceIssuedBy || "").trim(),
  items,
  createdBy: existingValuation?.createdBy || userEmail,
  updatedBy: userEmail,
});

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

    const structureData = await getProjectStructureData(pep);

    if (!structureData?.project) {
      return res.status(404).json({ message: "Proyecto no encontrado" });
    }
    const project = structureData.project;
    const tracking = await ProjectTrackingModel.findOne({ pep }).lean();
    const valuations = (tracking?.valuations || [])
      .slice()
      .sort((a, b) => toNumber(b.number) - toNumber(a.number));
    const valorizadoByElemento = getValorizadoByElemento(valuations);
    const structureRows = structureData.structureRows.map((row) => ({
      ...row,
      Valorizado: toNumber(valorizadoByElemento.get(String(row.ElementoPEP || "").trim())),
    }));

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
        estructuraResumen: structureData.structureSummary,
        historial: (tracking?.history || []).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
        actividades: (tracking?.activities || []).sort(
          (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
        ),
        valuations: valuations.map(serializeValuation),
        nextValuationNumber: getNextValuationNumber(tracking),
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
        $setOnInsert: buildTrackingSeed(pep, project),
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
        $setOnInsert: buildTrackingSeed(pep, project),
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
      .select("PEP Cliente Estado Monto Moneda FechaInicio FechaRequerida")
      .lean();

    const peps = projects.map((project) => project.PEP).filter(Boolean);
    const trackingDocs = await ProjectTrackingModel.find({ pep: { $in: peps } }).lean();
    const trackingMap = new Map(trackingDocs.map((doc) => [doc.pep, doc]));
    const projectMap = new Map(projects.map((project) => [project.PEP, project]));

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
    let totalValuations = 0;
    let invoicedValuations = 0;
    let pendingInvoiceValuations = 0;
    let totalValorizadoAmount = 0;

    const riskByProject = {};
    const monthlyHistoryBuckets = {};
    const monthlyValuationBuckets = {};
    const valuationByProject = {};
    const recentValuations = [];

    for (const project of projects) {
      const tracking = trackingMap.get(project.PEP);
      const history = tracking?.history || [];
      const activities = tracking?.activities || [];
      const valuations = tracking?.valuations || [];

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

      for (const valuation of valuations) {
        const valuationDate = parseDateOrNull(valuation.valuationDate || valuation.createdAt) || new Date();
        const monthKey = `${valuationDate.getFullYear()}-${String(valuationDate.getMonth() + 1).padStart(2, "0")}`;
        const amount = toNumber(valuation.totalValorizado);
        const isInvoiced = Boolean(valuation.invoiceIssued);

        totalValuations += 1;
        totalValorizadoAmount += amount;

        if (isInvoiced) {
          invoicedValuations += 1;
        } else {
          pendingInvoiceValuations += 1;
        }

        if (!monthlyValuationBuckets[monthKey]) {
          monthlyValuationBuckets[monthKey] = { amount: 0, qty: 0 };
        }
        monthlyValuationBuckets[monthKey].amount += amount;
        monthlyValuationBuckets[monthKey].qty += 1;

        if (!valuationByProject[project.PEP]) {
          valuationByProject[project.PEP] = { pep: project.PEP, amount: 0, qty: 0, pending: 0 };
        }
        valuationByProject[project.PEP].amount += amount;
        valuationByProject[project.PEP].qty += 1;
        if (!isInvoiced) {
          valuationByProject[project.PEP].pending += 1;
        }

        recentValuations.push({
          pep: project.PEP,
          projectName: tracking?.projectName || project.Descripcion || "Proyecto",
          client: project.Cliente || tracking?.client || "Sin cliente",
          number: toNumber(valuation.number),
          amount,
          date: valuationDate,
          invoiceIssued: isInvoiced,
          invoiceNumber: valuation.invoiceNumber || "",
        });
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

    const monthlyValuationSeries = Object.entries(monthlyValuationBuckets)
      .map(([monthKey, summary]) => {
        const [year, month] = monthKey.split("-");
        const monthIndex = Number(month) - 1;
        return {
          mes: `${MONTHS_ES[monthIndex]} ${year}`,
          monthKey,
          monto: toNumber(summary.amount),
          cantidad: toNumber(summary.qty),
        };
      })
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .slice(-6)
      .map(({ mes, monto, cantidad }) => ({ mes, monto, cantidad }));

    const valuationByProjectSeries = Object.values(valuationByProject)
      .map((row) => ({
        pep: row.pep,
        monto: toNumber(row.amount),
        cantidad: toNumber(row.qty),
        pendientes: toNumber(row.pending),
      }))
      .sort((a, b) => b.monto - a.monto)
      .slice(0, 10);

    const recentValuationRows = recentValuations
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 12)
      .map((row) => ({
        pep: row.pep,
        projectName: row.projectName,
        client: row.client,
        number: row.number,
        amount: row.amount,
        date: row.date,
        invoiceIssued: row.invoiceIssued,
        invoiceNumber: row.invoiceNumber,
      }));

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
        totalValuations,
        invoicedValuations,
        pendingInvoiceValuations,
        totalValorizadoAmount,
        monthlyValuationSeries,
        valuationByProjectSeries,
        recentValuationRows,
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
        $setOnInsert: buildTrackingSeed(pep, project),
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

const createValuation = async (req, res) => {
  try {
    const pep = String(req.params.pep || "").trim();
    if (!pep) return res.status(400).json({ message: "PEP es requerido" });

    const structureData = await getProjectStructureData(pep);
    if (!structureData?.project) {
      return res.status(404).json({ message: "Proyecto no encontrado" });
    }

    const tracking = (await ProjectTrackingModel.findOne({ pep })) || new ProjectTrackingModel(buildTrackingSeed(pep, structureData.project));
    const normalized = normalizeValuationItems(req.body.items, structureData.structureMap, pep);

    if (normalized.errors.length) {
      return res.status(400).json({ message: normalized.errors[0], errors: normalized.errors });
    }

    const userEmail = getUserEmail(req);
    const valuation = buildValuationPayload({
      body: req.body,
      items: normalized.items,
      nextNumber: getNextValuationNumber(tracking),
      userEmail,
      source: "manual",
    });

    tracking.set(buildTrackingSeed(pep, structureData.project));
    tracking.valuations.push(valuation);
    await tracking.save();

    const created = tracking.valuations[tracking.valuations.length - 1];
    return res.status(200).json({
      message: "Valorización registrada correctamente",
      data: serializeValuation(created),
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Error al registrar valorización" });
  }
};

const updateValuation = async (req, res) => {
  try {
    const pep = String(req.params.pep || "").trim();
    const valuationId = String(req.params.valuationId || "").trim();

    if (!pep) return res.status(400).json({ message: "PEP es requerido" });
    if (!valuationId) return res.status(400).json({ message: "ID de valorización requerido" });

    const structureData = await getProjectStructureData(pep);
    if (!structureData?.project) {
      return res.status(404).json({ message: "Proyecto no encontrado" });
    }

    const tracking = await ProjectTrackingModel.findOne({ pep });
    if (!tracking) {
      return res.status(404).json({ message: "Valorización no encontrada" });
    }

    const valuation = tracking.valuations.id(valuationId);
    if (!valuation) {
      return res.status(404).json({ message: "Valorización no encontrada" });
    }

    if (valuation.invoiceIssued) {
      return res.status(400).json({ message: "La valorización ya tiene factura emitida y no puede editarse" });
    }

    const normalized = normalizeValuationItems(req.body.items, structureData.structureMap, pep);
    if (normalized.errors.length) {
      return res.status(400).json({ message: normalized.errors[0], errors: normalized.errors });
    }

    const nextPayload = buildValuationPayload({
      existingValuation: valuation,
      body: req.body,
      items: normalized.items,
      nextNumber: toNumber(valuation.number),
      userEmail: getUserEmail(req),
      source: req.body.source || valuation.source || "manual",
    });

    valuation.set(nextPayload);
    tracking.set(buildTrackingSeed(pep, structureData.project));
    await tracking.save();

    return res.status(200).json({
      message: "Valorización actualizada correctamente",
      data: serializeValuation(valuation),
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Error al actualizar valorización" });
  }
};

const downloadValuationTemplate = async (req, res) => {
  try {
    const pep = String(req.params.pep || "").trim();
    if (!pep) return res.status(400).json({ message: "PEP es requerido" });

    const structureData = await getProjectStructureData(pep);
    if (!structureData?.project) {
      return res.status(404).json({ message: "Proyecto no encontrado" });
    }

    const templateRows = structureData.structureRows
      .filter((row) => isCargaEnabled(row.Carga))
      .map((row) => ({
      pep,
      elementoPEP: row.ElementoPEP || "",
      nivel: row.Nivel || "",
      descripcion: row.Descripcion || "",
      costo: toNumber(row.Costo),
      venta: toNumber(row.Venta),
      real: toNumber(row.Real),
      valorizado: 0,
      comentario: "",
    }));

    const ws = xlsx.utils.json_to_sheet(templateRows, {
      header: ["pep", "elementoPEP", "nivel", "descripcion", "costo", "venta", "real", "valorizado", "comentario"],
    });

    ws["!cols"] = [
      { wch: 18 },
      { wch: 24 },
      { wch: 10 },
      { wch: 45 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 28 },
    ];

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Valorizacion");

    const buffer = xlsx.write(wb, { bookType: "xlsx", type: "buffer" });
    res.setHeader("Content-Disposition", `attachment; filename=plantilla_valorizacion_${pep}.xlsx`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.status(200).send(buffer);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Error al generar plantilla de valorización" });
  }
};

const createValuationFromExcel = async (req, res) => {
  try {
    const pep = String(req.params.pep || "").trim();
    if (!pep) return res.status(400).json({ message: "PEP es requerido" });
    if (!req.file) return res.status(400).json({ message: "Archivo Excel requerido" });

    const structureData = await getProjectStructureData(pep);
    if (!structureData?.project) {
      return res.status(404).json({ message: "Proyecto no encontrado" });
    }

    const workbook = xlsx.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false });
    if (!rows.length) {
      return res.status(400).json({ message: "El archivo no tiene filas de datos" });
    }

    const normalized = normalizeValuationItems(rows, structureData.structureMap, pep);
    if (normalized.errors.length) {
      return res.status(400).json({ message: normalized.errors[0], errors: normalized.errors });
    }

    const tracking = (await ProjectTrackingModel.findOne({ pep })) || new ProjectTrackingModel(buildTrackingSeed(pep, structureData.project));
    const valuation = buildValuationPayload({
      body: req.body,
      items: normalized.items,
      nextNumber: getNextValuationNumber(tracking),
      userEmail: getUserEmail(req),
      source: "excel",
    });

    tracking.set(buildTrackingSeed(pep, structureData.project));
    tracking.valuations.push(valuation);
    await tracking.save();

    const created = tracking.valuations[tracking.valuations.length - 1];
    return res.status(200).json({
      message: "Valorización cargada correctamente",
      data: serializeValuation(created),
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Error al procesar la valorización desde Excel" });
  }
};

module.exports = {
  getProjects,
  getProjectDetail,
  addHistoryEntry,
  addActivity,
  updateActivity,
  createValuation,
  updateValuation,
  getDashboard,
  downloadGanttTemplate,
  downloadValuationTemplate,
  bulkUploadActivities,
  createValuationFromExcel,
};