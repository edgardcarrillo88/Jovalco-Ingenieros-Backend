const ComercialModel = require('../../../models/comercial/comercial');
const ProjectTrackingModel = require('../../../models/proyectos/project_tracking');
const SolpedModel = require('../../../models/logistica/solped');
const SolpedCounterModel = require('../../../models/logistica/solped_counter');
const InvoiceModel = require('../../../models/finanzas/invoice');
const InvoiceCounterModel = require('../../../models/finanzas/invoice_counter');
const RecurrentPayableModel = require('../../../models/finanzas/recurrent_payable');
const {
  ACCOUNTING_CLASSES,
  ACCOUNTING_CATALOG,
  LOAN_COMPONENTS,
  DEFAULT_COST_CENTERS,
} = require('../../../constants/accounting_catalog');

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const toNumber = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const parseDateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toPositiveAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return amount > 0 ? amount : 0;
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'si' || normalized === 'yes';
  }
  return Boolean(value);
};

const getUserRole = (req) => String(req.headers['x-user-role'] || req.body?.userRole || '').trim().toLowerCase();

const canOverrideAccounting = (req) => {
  const role = getUserRole(req);
  return ['finanzas', 'contabilidad', 'admin'].includes(role);
};

const normalizeAccountingInput = (payload = {}, current = {}) => {
  const accountingClass = String(payload.accountingClass || current.accountingClass || '').trim().toUpperCase();
  const accountingCategory = String(payload.accountingCategory || current.accountingCategory || '').trim();
  const accountingSubcategory = String(payload.accountingSubcategory || current.accountingSubcategory || '').trim();
  const costCenter = String(payload.costCenter || current.costCenter || '').trim();
  const loanComponent = String(payload.loanComponent || current.loanComponent || 'NONE').trim().toUpperCase();

  if (!accountingClass || !ACCOUNTING_CATALOG[accountingClass]) {
    return { ok: false, message: 'Tipo contable invalido' };
  }

  const validCategories = ACCOUNTING_CATALOG[accountingClass] || [];
  if (!accountingCategory || !validCategories.includes(accountingCategory)) {
    return { ok: false, message: 'Categoria contable invalida' };
  }

  if (!costCenter) {
    return { ok: false, message: 'Centro de costo es requerido' };
  }

  if (accountingClass === 'LOAN' && !['CAPITAL', 'INTEREST'].includes(loanComponent)) {
    return { ok: false, message: 'Prestamo requiere componente CAPITAL o INTEREST' };
  }

  if (accountingClass !== 'LOAN' && loanComponent !== 'NONE') {
    return { ok: false, message: 'Componente de prestamo solo aplica para tipo LOAN' };
  }

  return {
    ok: true,
    value: {
      accountingClass,
      accountingCategory,
      accountingSubcategory,
      costCenter,
      loanComponent,
    },
  };
};

const hasAccountingOverride = (payload = {}) =>
  ['accountingClass', 'accountingCategory', 'accountingSubcategory', 'costCenter', 'loanComponent']
    .some((field) => payload[field] !== undefined);

const getUserEmail = (req) =>
  String(req.headers['x-user-email'] || req.body?.userEmail || 'sistema').trim().toLowerCase();

const getNextInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const counter = await InvoiceCounterModel.findOneAndUpdate(
    { name: `INV_${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );

  return `FAC-${year}-${String(counter.seq).padStart(5, '0')}`;
};

const getNextSolpedNumber = async () => {
  const year = new Date().getFullYear();
  const counter = await SolpedCounterModel.findOneAndUpdate(
    { name: `SOLPED_${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );

  return `SOLPED-${year}-${String(counter.seq).padStart(4, '0')}`;
};

const FREQUENCY_MONTHS = {
  Mensual: 1,
  Bimestral: 2,
  Trimestral: 3,
  Semestral: 6,
  Anual: 12,
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

const getDaysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();

const addMonthsUsingReferenceDay = (date, months, referenceDay) => {
  const base = new Date(date);
  const targetMonthDate = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const maxDay = getDaysInMonth(targetMonthDate.getFullYear(), targetMonthDate.getMonth());
  const safeDay = Math.max(1, Math.min(toNumber(referenceDay) || 1, maxDay));
  return new Date(targetMonthDate.getFullYear(), targetMonthDate.getMonth(), safeDay);
};

const ensureRecurrentSolpedsGenerated = async () => {
  const now = new Date();
  const triggerDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5);

  const recurrentRows = await RecurrentPayableModel.find({
    deleted: { $ne: true },
    isActive: true,
  })
    .select('concept category provider pep amount currency frequency paymentReferenceDay nextDueDate accountingClass accountingCategory accountingSubcategory costCenter loanComponent')
    .lean();

  for (const recurrent of recurrentRows) {
    const monthsToAdd = FREQUENCY_MONTHS[recurrent.frequency] || 1;
    let cycleDate = parseDateOrNull(recurrent.nextDueDate);
    if (!cycleDate) continue;

    cycleDate = startOfDay(cycleDate);

    let safety = 0;
    let moved = false;
    while (cycleDate <= triggerDate && safety < 24) {
      const existing = await SolpedModel.findOne({
        deleted: false,
        source: 'RECURRENTE',
        recurrentPayableId: recurrent._id,
        recurrentCycleDate: { $gte: startOfDay(cycleDate), $lt: endOfDay(cycleDate) },
      })
        .select('_id')
        .lean();

      if (!existing) {
        const autoSolped = new SolpedModel({
          solpedNumber: await getNextSolpedNumber(),
          requesterName: recurrent.provider || 'Sistema',
          requesterEmail: 'sistema@jovalco.local',
          accountingClass: recurrent.accountingClass || 'OTHER',
          accountingCategory: recurrent.accountingCategory || 'Otros operativos',
          accountingSubcategory: recurrent.accountingSubcategory || '',
          costCenter: recurrent.costCenter || 'General',
          loanComponent: recurrent.loanComponent || 'NONE',
          accountingUpdatedBy: 'sistema',
          observaciones: `SOLPED automatica de recurrente: ${String(recurrent.concept || '').trim()}`,
          totalEstimado: toNumber(recurrent.amount),
          status: 'Aprobado',
          paymentStatus: 'Pendiente',
          source: 'RECURRENTE',
          recurrentPayableId: recurrent._id,
          recurrentCycleDate: cycleDate,
          recurrentConcept: String(recurrent.concept || '').trim(),
          items: [],
        });

        await autoSolped.save();
      }

      cycleDate = addMonthsUsingReferenceDay(cycleDate, monthsToAdd, recurrent.paymentReferenceDay);
      moved = true;
      safety += 1;
    }

    if (moved) {
      await RecurrentPayableModel.updateOne(
        { _id: recurrent._id, deleted: { $ne: true } },
        {
          $set: {
            nextDueDate: cycleDate,
            updatedBy: 'sistema',
          },
        },
      );
    }
  }
};

const getMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const getLastMonths = (count = 6) => {
  const now = new Date();

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    return {
      key: getMonthKey(date),
      mes: `${MONTHS_ES[date.getMonth()]} ${date.getFullYear()}`,
      billed: 0,
      payables: 0,
    };
  });
};

const getInvoiceCandidates = async (req, res) => {
  try {
    const projects = await ComercialModel.find({ deleted: { $ne: true }, Estado: 'Adjudicado' })
      .select('PEP Descripcion Cliente Moneda')
      .lean();

    const peps = projects.map((project) => String(project.PEP || '').trim()).filter(Boolean);
    const trackingDocs = await ProjectTrackingModel.find({ pep: { $in: peps } })
      .select('pep valuations')
      .lean();

    const projectMap = new Map();
    projects.forEach((project) => {
      const pep = String(project.PEP || '').trim();
      if (!pep) return;

      projectMap.set(pep, {
        pep,
        projectName: String(project.Descripcion || 'Sin nombre').trim(),
        client: String(project.Cliente || 'Sin cliente').trim(),
        currency: String(project.Moneda || 'PEN').trim(),
      });
    });

    const pendingValuations = [];
    trackingDocs.forEach((tracking) => {
      const pep = String(tracking.pep || '').trim();
      const meta = projectMap.get(pep) || {
        pep,
        projectName: String(tracking.projectName || 'Proyecto').trim(),
        client: String(tracking.client || 'Sin cliente').trim(),
        currency: 'PEN',
      };

      (tracking.valuations || []).forEach((valuation) => {
        if (valuation.invoiceIssued) return;

        pendingValuations.push({
          valuationId: String(valuation._id),
          valuationNumber: toNumber(valuation.number),
          valuationDate: valuation.valuationDate || valuation.createdAt || null,
          pep: meta.pep,
          projectName: meta.projectName,
          client: meta.client,
          amount: toNumber(valuation.totalValorizado),
          currency: meta.currency,
          source: valuation.source || 'manual',
          comments: valuation.comments || '',
        });
      });
    });

    pendingValuations.sort(
      (a, b) => new Date(a.valuationDate || 0).getTime() - new Date(b.valuationDate || 0).getTime(),
    );

    const projectOptions = Array.from(projectMap.values()).sort((a, b) => a.pep.localeCompare(b.pep));

    return res.status(200).json({
      success: true,
      data: {
        projectOptions,
        pendingValuations,
      },
    });
  } catch (error) {
    console.error('[getInvoiceCandidates] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener valorizaciones por facturar' });
  }
};

const generateInvoiceFromValuation = async (req, res) => {
  try {
    const pep = String(req.body.pep || '').trim();
    const valuationId = String(req.body.valuationId || '').trim();

    if (!pep) return res.status(400).json({ success: false, message: 'PEP es requerido' });
    if (!valuationId) return res.status(400).json({ success: false, message: 'ID de valorizacion es requerido' });

    const tracking = await ProjectTrackingModel.findOne({ pep });
    if (!tracking) {
      return res.status(404).json({ success: false, message: 'No se encontro seguimiento del proyecto' });
    }

    const valuation = tracking.valuations.id(valuationId);
    if (!valuation) {
      return res.status(404).json({ success: false, message: 'Valorizacion no encontrada para el PEP seleccionado' });
    }

    if (valuation.invoiceIssued) {
      return res.status(400).json({ success: false, message: 'La valorizacion ya tiene factura emitida' });
    }

    const project = await ComercialModel.findOne({ PEP: pep, deleted: { $ne: true } })
      .select('Descripcion Cliente Moneda')
      .lean();

    const issueDate = parseDateOrNull(req.body.issueDate) || new Date();
    const dueDate = parseDateOrNull(req.body.dueDate);
    const userEmail = getUserEmail(req);

    let invoiceNumber = String(req.body.invoiceNumber || '').trim();
    if (!invoiceNumber) {
      invoiceNumber = await getNextInvoiceNumber();
    }

    const existing = await InvoiceModel.findOne({ invoiceNumber, deleted: { $ne: true } }).lean();
    if (existing) {
      return res.status(400).json({ success: false, message: 'El numero de factura ya existe' });
    }

    const baseAmount = toNumber(valuation.totalValorizado);
    const igvApplied = parseBoolean(req.body.igvApplied);
    const igvRate = igvApplied ? 18 : 0;
    const igvAmount = baseAmount * (igvRate / 100);

    const detraccionApplied = parseBoolean(req.body.detraccionApplied);
    const detraccionRate = detraccionApplied ? toNumber(req.body.detraccionRate) : 0;
    if (detraccionApplied && ![5, 10, 12].includes(detraccionRate)) {
      return res.status(400).json({ success: false, message: 'La detraccion debe ser 5%, 10% o 12%' });
    }
    const detraccionAmount = detraccionApplied ? baseAmount * (detraccionRate / 100) : 0;

    const grossAmount = baseAmount + igvAmount;
    const netAmount = Math.max(grossAmount - detraccionAmount, 0);
    const description = String(req.body.description || req.body.notes || project?.Descripcion || tracking.projectName || 'Factura').trim();

    const invoice = new InvoiceModel({
      invoiceNumber,
      pep,
      projectName: String(project?.Descripcion || tracking.projectName || 'Proyecto').trim(),
      client: String(project?.Cliente || tracking.client || 'Sin cliente').trim(),
      valuationId: valuation._id,
      valuationNumber: toNumber(valuation.number),
      valuationDate: valuation.valuationDate || valuation.createdAt || null,
      description,
      baseAmount,
      amount: grossAmount,
      igvApplied,
      igvRate,
      igvAmount,
      detraccionApplied,
      detraccionRate,
      detraccionAmount,
      netAmount,
      currency: String(project?.Moneda || 'PEN').trim(),
      issueDate,
      dueDate,
      notes: String(req.body.notes || '').trim(),
      status: 'Pendiente',
      createdBy: userEmail,
      updatedBy: userEmail,
    });

    await invoice.save();

    valuation.invoiceIssued = true;
    valuation.invoiceNumber = invoiceNumber;
    valuation.invoiceIssuedAt = issueDate;
    valuation.invoiceIssuedBy = userEmail;
    valuation.updatedBy = userEmail;

    await tracking.save();

    return res.status(201).json({
      success: true,
      message: 'Factura generada correctamente desde valorizacion',
      data: invoice,
    });
  } catch (error) {
    console.error('[generateInvoiceFromValuation] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al generar factura desde valorizacion' });
  }
};

const getInvoices = async (req, res) => {
  try {
    const pep = String(req.query.pep || '').trim();
    const status = String(req.query.status || '').trim();

    const filter = { deleted: { $ne: true } };
    if (pep) filter.pep = pep;
    if (status) filter.status = status;

    const rows = await InvoiceModel.find(filter).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[getInvoices] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener facturas' });
  }
};

const updateInvoiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body.status || '').trim();

    const allowed = ['Pendiente', 'Cobrado', 'Vencido', 'Anulado'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Estado de factura invalido' });
    }

    const update = {
      status,
      updatedBy: getUserEmail(req),
    };

    if (status === 'Cobrado') {
      update.paidDate = parseDateOrNull(req.body.paidDate) || new Date();
    }

    if (status !== 'Cobrado') {
      update.paidDate = null;
    }

    const invoice = await InvoiceModel.findOneAndUpdate(
      { _id: id, deleted: { $ne: true } },
      update,
      { new: true },
    );

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Factura no encontrada' });
    }

    return res.status(200).json({ success: true, message: 'Estado de factura actualizado', data: invoice });
  } catch (error) {
    console.error('[updateInvoiceStatus] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar estado de factura' });
  }
};

const getPayables = async (req, res) => {
  try {
    const includePaid = String(req.query.includePaid || 'false').toLowerCase() === 'true';

    const solpedFilter = {
      deleted: false,
      status: 'Aprobado',
    };

    if (!includePaid) {
      solpedFilter.paymentStatus = { $ne: 'Pagado' };
    }

    const solpeds = await SolpedModel.find(solpedFilter)
      .select('solpedNumber requesterName requesterEmail totalEstimado paidAmount paymentStatus paymentReference paidAt createdAt source recurrentConcept recurrentCycleDate accountingClass accountingCategory accountingSubcategory costCenter loanComponent cuentaCargo')
      .sort({ createdAt: -1 })
      .lean();

    const solpedRows = solpeds.map((row) => ({
      id: String(row._id),
      source: 'SOLPED',
      reference: row.solpedNumber || 'SOLPED',
      concept: row.source === 'RECURRENTE'
        ? `RECURRENTE: ${String(row.recurrentConcept || 'Cargo recurrente').trim()}`
        : `SOLPED ${row.solpedNumber || ''}`.trim(),
      provider: row.requesterName || row.requesterEmail || 'Solicitante',
      pep: '',
      amount: toNumber(row.totalEstimado),
      paidAmount: toNumber(row.paidAmount),
      currency: 'PEN',
      accountingClass: row.accountingClass || 'OTHER',
      accountingCategory: row.accountingCategory || 'Sin categoria',
      accountingSubcategory: row.accountingSubcategory || '',
      costCenter: row.costCenter || '',
      loanComponent: row.loanComponent || 'NONE',
      cuentaCargo: row.cuentaCargo || '',
      dueDate: row.recurrentCycleDate || row.createdAt,
      status: row.paymentStatus || 'Pendiente',
      paymentReference: row.paymentReference || '',
      paidAt: row.paidAt || null,
    }));

    const rows = [...solpedRows].sort(
      (a, b) => new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime(),
    );

    const rowsWithBalance = rows.map((row) => {
      const totalAmount = toNumber(row.amount);
      const paidAmount = Math.min(toNumber(row.paidAmount), totalAmount);
      return {
        ...row,
        paidAmount,
        remainingAmount: Math.max(totalAmount - paidAmount, 0),
      };
    });

    const openAmount = rowsWithBalance
      .filter((row) => row.status !== 'Pagado')
      .reduce((acc, row) => acc + toNumber(row.remainingAmount), 0);

    return res.status(200).json({
      success: true,
      data: {
        rows: rowsWithBalance,
        summary: {
          total: rowsWithBalance.length,
          open: rowsWithBalance.filter((row) => row.status !== 'Pagado').length,
          openAmount,
        },
      },
    });
  } catch (error) {
    console.error('[getPayables] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener cuentas por pagar' });
  }
};

const createRecurrentPayable = async (req, res) => {
  try {
    const concept = String(req.body.concept || '').trim();
    const category = String(req.body.category || '').trim();
    const nextDueDate = parseDateOrNull(req.body.nextDueDate);
    const amount = toNumber(req.body.amount);
    const paymentReferenceDay = toNumber(req.body.paymentReferenceDay);
    const accounting = normalizeAccountingInput(req.body);

    if (!concept) return res.status(400).json({ success: false, message: 'Concepto es requerido' });
    if (!category) return res.status(400).json({ success: false, message: 'Categoria es requerida' });
    if (!nextDueDate) return res.status(400).json({ success: false, message: 'Fecha de vencimiento invalida' });
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Monto debe ser mayor a cero' });
    if (paymentReferenceDay < 1 || paymentReferenceDay > 31) {
      return res.status(400).json({ success: false, message: 'Dia de referencia de pago invalido (1-31)' });
    }
    if (!accounting.ok) return res.status(400).json({ success: false, message: accounting.message });

    const row = new RecurrentPayableModel({
      concept,
      category,
      provider: String(req.body.provider || '').trim(),
      pep: String(req.body.pep || '').trim(),
      accountingClass: accounting.value.accountingClass,
      accountingCategory: accounting.value.accountingCategory,
      accountingSubcategory: accounting.value.accountingSubcategory,
      costCenter: accounting.value.costCenter,
      loanComponent: accounting.value.loanComponent,
      accountingUpdatedBy: getUserEmail(req),
      amount,
      currency: String(req.body.currency || 'PEN').trim(),
      frequency: String(req.body.frequency || 'Mensual').trim(),
      paymentReferenceDay,
      isActive: true,
      nextDueDate,
      status: 'Pendiente',
      notes: String(req.body.notes || '').trim(),
      createdBy: getUserEmail(req),
      updatedBy: getUserEmail(req),
    });

    const saved = await row.save();

    return res.status(201).json({
      success: true,
      message: 'Cuenta por pagar recurrente registrada',
      data: saved,
    });
  } catch (error) {
    console.error('[createRecurrentPayable] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al crear cuenta recurrente' });
  }
};

const getRecurrentPayables = async (req, res) => {
  try {
    const rows = await RecurrentPayableModel.find({ deleted: { $ne: true } })
      .select('concept category provider pep amount currency frequency paymentReferenceDay nextDueDate isActive notes accountingClass accountingCategory accountingSubcategory costCenter loanComponent createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[getRecurrentPayables] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener recurrentes' });
  }
};

const toggleRecurrentPayableActive = async (req, res) => {
  try {
    const { id } = req.params;
    const isActive = parseBoolean(req.body.isActive);

    const row = await RecurrentPayableModel.findOneAndUpdate(
      { _id: id, deleted: { $ne: true } },
      {
        isActive,
        updatedBy: getUserEmail(req),
      },
      { new: true },
    );

    if (!row) {
      return res.status(404).json({ success: false, message: 'Cuenta recurrente no encontrada' });
    }

    return res.status(200).json({
      success: true,
      message: isActive ? 'Recurrente activada' : 'Recurrente desactivada',
      data: row,
    });
  } catch (error) {
    console.error('[toggleRecurrentPayableActive] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar estado activo de la recurrente' });
  }
};

const updateRecurrentPayableStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body.status || '').trim();
    const userEmail = getUserEmail(req);

    const allowed = ['Pendiente', 'Programado', 'Parcial', 'Pagado'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Estado de pago invalido' });
    }

    const row = await RecurrentPayableModel.findOne({ _id: id, deleted: { $ne: true } });
    if (!row) {
      return res.status(404).json({ success: false, message: 'Cuenta recurrente no encontrada' });
    }

    const totalAmount = toNumber(row.amount);
    const currentPaidAmount = toNumber(row.paidAmount);
    const remainingBefore = Math.max(totalAmount - currentPaidAmount, 0);
    const paymentAmount = toPositiveAmount(req.body.paymentAmount);
    const paidAt = parseDateOrNull(req.body.paidAt) || new Date();
    const paymentReference = String(req.body.paymentReference || '').trim();
    const wantsAccountingOverride = hasAccountingOverride(req.body);

    if (wantsAccountingOverride && !canOverrideAccounting(req)) {
      return res.status(403).json({ success: false, message: 'Solo finanzas/contabilidad puede reclasificar en pago' });
    }

    const normalizedAccounting = wantsAccountingOverride
      ? normalizeAccountingInput(req.body, row)
      : normalizeAccountingInput({}, row);

    if (!normalizedAccounting.ok) {
      return res.status(400).json({ success: false, message: normalizedAccounting.message });
    }

    if (status === 'Parcial') {
      if (paymentAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Debe ingresar monto de pago parcial mayor a cero' });
      }
      if (paymentAmount >= remainingBefore) {
        return res.status(400).json({ success: false, message: 'El pago parcial debe ser menor al saldo pendiente' });
      }
    }

    if (status === 'Pagado' && remainingBefore > 0 && paymentAmount > remainingBefore) {
      return res.status(400).json({ success: false, message: 'El monto pagado no puede exceder el saldo pendiente' });
    }

    let nextPaidAmount = currentPaidAmount;
    let appliedPaymentAmount = 0;
    if (status === 'Parcial') {
      nextPaidAmount = currentPaidAmount + paymentAmount;
      appliedPaymentAmount = paymentAmount;
    } else if (status === 'Pagado') {
      const settledAmount = paymentAmount > 0 ? paymentAmount : remainingBefore;
      nextPaidAmount = currentPaidAmount + settledAmount;
      if (nextPaidAmount < totalAmount) {
        return res.status(400).json({ success: false, message: 'Para marcar como Pagado debe cubrirse el total pendiente' });
      }
      nextPaidAmount = totalAmount;
      appliedPaymentAmount = settledAmount;
    } else if (status === 'Pendiente' || status === 'Programado') {
      nextPaidAmount = currentPaidAmount;
    }

    row.status = status;
    row.paymentReference = paymentReference;
    row.paidAmount = Math.min(nextPaidAmount, totalAmount);
    row.paidAt = status === 'Pagado' ? paidAt : row.paidAt;
    row.updatedBy = userEmail;

    if (wantsAccountingOverride) {
      row.accountingClass = normalizedAccounting.value.accountingClass;
      row.accountingCategory = normalizedAccounting.value.accountingCategory;
      row.accountingSubcategory = normalizedAccounting.value.accountingSubcategory;
      row.costCenter = normalizedAccounting.value.costCenter;
      row.loanComponent = normalizedAccounting.value.loanComponent;
      row.accountingUpdatedBy = userEmail;
    }

    if ((status === 'Parcial' || status === 'Pagado') && appliedPaymentAmount > 0) {
      row.paymentHistory = row.paymentHistory || [];
      row.paymentHistory.push({
        paymentDate: paidAt,
        amount: appliedPaymentAmount,
        reference: paymentReference,
        statusAfter: status,
        accountingSnapshot: normalizedAccounting.value,
        overrideApplied: wantsAccountingOverride,
        overrideReason: String(req.body.overrideReason || '').trim(),
        overrideBy: wantsAccountingOverride ? userEmail : '',
        registeredBy: userEmail,
        createdAt: new Date(),
      });
    }

    const saved = await row.save();

    return res.status(200).json({ success: true, message: 'Estado actualizado', data: saved });
  } catch (error) {
    console.error('[updateRecurrentPayableStatus] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar estado de cuenta recurrente' });
  }
};

const updateSolpedPaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body.status || '').trim();
    const userEmail = getUserEmail(req);

    const allowed = ['Pendiente', 'Programado', 'Parcial', 'Pagado'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Estado de pago invalido' });
    }

    const row = await SolpedModel.findOne({ _id: id, deleted: false });

    if (!row) {
      return res.status(404).json({ success: false, message: 'SOLPED no encontrada' });
    }

    const totalAmount = toNumber(row.totalEstimado);
    const currentPaidAmount = toNumber(row.paidAmount);
    const remainingBefore = Math.max(totalAmount - currentPaidAmount, 0);
    const paymentAmount = toPositiveAmount(req.body.paymentAmount);
    const paidAt = parseDateOrNull(req.body.paidAt) || new Date();
    const paymentReference = String(req.body.paymentReference || '').trim();
    const wantsAccountingOverride = hasAccountingOverride(req.body);

    if (wantsAccountingOverride && !canOverrideAccounting(req)) {
      return res.status(403).json({ success: false, message: 'Solo finanzas/contabilidad puede reclasificar en pago' });
    }

    const normalizedAccounting = wantsAccountingOverride
      ? normalizeAccountingInput(req.body, row)
      : normalizeAccountingInput({}, row);

    if (!normalizedAccounting.ok) {
      return res.status(400).json({ success: false, message: normalizedAccounting.message });
    }

    if (status === 'Parcial') {
      if (paymentAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Debe ingresar monto de pago parcial mayor a cero' });
      }
      if (paymentAmount >= remainingBefore) {
        return res.status(400).json({ success: false, message: 'El pago parcial debe ser menor al saldo pendiente' });
      }
    }

    if (status === 'Pagado' && remainingBefore > 0 && paymentAmount > remainingBefore) {
      return res.status(400).json({ success: false, message: 'El monto pagado no puede exceder el saldo pendiente' });
    }

    let nextPaidAmount = currentPaidAmount;
    let appliedPaymentAmount = 0;
    if (status === 'Parcial') {
      nextPaidAmount = currentPaidAmount + paymentAmount;
      appliedPaymentAmount = paymentAmount;
    } else if (status === 'Pagado') {
      const settledAmount = paymentAmount > 0 ? paymentAmount : remainingBefore;
      nextPaidAmount = currentPaidAmount + settledAmount;
      if (nextPaidAmount < totalAmount) {
        return res.status(400).json({ success: false, message: 'Para marcar como Pagado debe cubrirse el total pendiente' });
      }
      nextPaidAmount = totalAmount;
      appliedPaymentAmount = settledAmount;
    } else if (status === 'Pendiente' || status === 'Programado') {
      nextPaidAmount = currentPaidAmount;
    }

    row.paymentStatus = status;
    row.paymentReference = paymentReference;
    row.paidAmount = Math.min(nextPaidAmount, totalAmount);
    row.paidAt = status === 'Pagado' ? paidAt : row.paidAt;

    const cuentaCargo = String(req.body.cuentaCargo || '').trim();
    if (cuentaCargo && ['IBK-SOL', 'IBK-USD', 'CAJA-CHICA'].includes(cuentaCargo)) {
      row.cuentaCargo = cuentaCargo;
    }

    if (wantsAccountingOverride) {
      row.accountingClass = normalizedAccounting.value.accountingClass;
      row.accountingCategory = normalizedAccounting.value.accountingCategory;
      row.accountingSubcategory = normalizedAccounting.value.accountingSubcategory;
      row.costCenter = normalizedAccounting.value.costCenter;
      row.loanComponent = normalizedAccounting.value.loanComponent;
      row.accountingUpdatedBy = userEmail;
    }

    if ((status === 'Parcial' || status === 'Pagado') && appliedPaymentAmount > 0) {
      row.paymentHistory = row.paymentHistory || [];
      row.paymentHistory.push({
        paymentDate: paidAt,
        amount: appliedPaymentAmount,
        reference: paymentReference,
        statusAfter: status,
        accountingSnapshot: normalizedAccounting.value,
        overrideApplied: wantsAccountingOverride,
        overrideReason: String(req.body.overrideReason || '').trim(),
        overrideBy: wantsAccountingOverride ? userEmail : '',
        registeredBy: userEmail,
        createdAt: new Date(),
      });
    }

    const saved = await row.save();

    return res.status(200).json({ success: true, message: 'Estado de pago de SOLPED actualizado', data: saved });
  } catch (error) {
    console.error('[updateSolpedPaymentStatus] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar estado de pago de SOLPED' });
  }
};

const updateRecurrentPayableById = async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = getUserEmail(req);
    const ALLOWED = [
      'concept', 'category', 'provider', 'pep',
      'accountingClass', 'accountingCategory', 'accountingSubcategory', 'costCenter', 'loanComponent',
      'amount', 'currency', 'frequency', 'paymentReferenceDay', 'nextDueDate', 'notes', 'isActive',
    ];

    const update = {};
    ALLOWED.forEach((field) => {
      if (req.body[field] !== undefined) {
        update[field] = req.body[field];
      }
    });

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'No hay campos para actualizar' });
    }

    update.updatedBy = userEmail;

    const row = await RecurrentPayableModel.findOneAndUpdate(
      { _id: id, deleted: { $ne: true } },
      { $set: update },
      { new: true },
    );

    if (!row) {
      return res.status(404).json({ success: false, message: 'Cuenta recurrente no encontrada' });
    }

    return res.status(200).json({ success: true, message: 'Recurrente actualizada', data: row });
  } catch (error) {
    console.error('[updateRecurrentPayableById] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar cuenta recurrente' });
  }
};

const deleteRecurrentPayableById = async (req, res) => {
  try {
    const { id } = req.params;

    const row = await RecurrentPayableModel.findOneAndUpdate(
      { _id: id, deleted: { $ne: true } },
      { $set: { deleted: true, updatedBy: getUserEmail(req) } },
      { new: true },
    );

    if (!row) {
      return res.status(404).json({ success: false, message: 'Cuenta recurrente no encontrada' });
    }

    return res.status(200).json({ success: true, message: 'Recurrente eliminada (soft delete)' });
  } catch (error) {
    console.error('[deleteRecurrentPayableById] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al eliminar cuenta recurrente' });
  }
};

const getPaymentsHistory = async (req, res) => {
  try {
    const page = Math.max(toNumber(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(toNumber(req.query.pageSize) || 10, 1), 50);

    const [solpeds, recurrent] = await Promise.all([
      SolpedModel.find({ deleted: false, 'paymentHistory.0': { $exists: true } })
        .select('solpedNumber requesterName requesterEmail totalEstimado accountingClass accountingCategory accountingSubcategory costCenter loanComponent paymentHistory')
        .lean(),
      RecurrentPayableModel.find({ deleted: { $ne: true }, 'paymentHistory.0': { $exists: true } })
        .select('concept provider category amount currency accountingClass accountingCategory accountingSubcategory costCenter loanComponent paymentHistory')
        .lean(),
    ]);

    const items = [
      ...solpeds.flatMap((row) =>
        (row.paymentHistory || []).map((payment, index) => ({
          id: `SOLPED-${String(row._id)}-${index}`,
          source: 'SOLPED',
          reference: row.solpedNumber || 'SOLPED',
          concept: `SOLPED ${row.solpedNumber || ''}`.trim(),
          provider: row.requesterName || row.requesterEmail || 'Solicitante',
          totalAmount: toNumber(row.totalEstimado),
          currency: 'PEN',
          paymentAmount: toNumber(payment.amount),
          paymentDate: payment.paymentDate || payment.createdAt || null,
          paymentReference: payment.reference || '',
          statusAfter: payment.statusAfter || 'Parcial',
          accountingClass: payment.accountingSnapshot?.accountingClass || row.accountingClass || 'OTHER',
          accountingCategory: payment.accountingSnapshot?.accountingCategory || row.accountingCategory || 'Sin categoria',
          accountingSubcategory: payment.accountingSnapshot?.accountingSubcategory || row.accountingSubcategory || '',
          costCenter: payment.accountingSnapshot?.costCenter || row.costCenter || '',
          loanComponent: payment.accountingSnapshot?.loanComponent || row.loanComponent || 'NONE',
          registeredBy: payment.registeredBy || 'sistema',
        })),
      ),
      ...recurrent.flatMap((row, rowIndex) =>
        (row.paymentHistory || []).map((payment, paymentIndex) => ({
          id: `REC-${String(row._id || rowIndex)}-${paymentIndex}`,
          source: 'RECURRENTE',
          reference: `REC-${String(row._id).slice(-6).toUpperCase()}`,
          concept: row.concept || 'Recurrente',
          provider: row.provider || row.category || '-',
          totalAmount: toNumber(row.amount),
          currency: row.currency || 'PEN',
          paymentAmount: toNumber(payment.amount),
          paymentDate: payment.paymentDate || payment.createdAt || null,
          paymentReference: payment.reference || '',
          statusAfter: payment.statusAfter || 'Parcial',
          accountingClass: payment.accountingSnapshot?.accountingClass || row.accountingClass || 'OTHER',
          accountingCategory: payment.accountingSnapshot?.accountingCategory || row.accountingCategory || 'Sin categoria',
          accountingSubcategory: payment.accountingSnapshot?.accountingSubcategory || row.accountingSubcategory || '',
          costCenter: payment.accountingSnapshot?.costCenter || row.costCenter || '',
          loanComponent: payment.accountingSnapshot?.loanComponent || row.loanComponent || 'NONE',
          registeredBy: payment.registeredBy || 'sistema',
        })),
      ),
    ].sort((a, b) => new Date(b.paymentDate || 0).getTime() - new Date(a.paymentDate || 0).getTime());

    const total = items.length;
    const start = (page - 1) * pageSize;
    const rows = items.slice(start, start + pageSize);

    return res.status(200).json({
      success: true,
      data: {
        rows,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(Math.ceil(total / pageSize), 1),
        },
      },
    });
  } catch (error) {
    console.error('[getPaymentsHistory] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener historial de pagos' });
  }
};

const getAccountingCatalog = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        classes: ACCOUNTING_CLASSES,
        categoriesByClass: ACCOUNTING_CATALOG,
        loanComponents: LOAN_COMPONENTS,
        costCenters: DEFAULT_COST_CENTERS,
      },
    });
  } catch (error) {
    console.error('[getAccountingCatalog] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener catalogo contable' });
  }
};

const getFinancialStatement = async (req, res) => {
  try {
    const selectedYear = toNumber(req.query.year) || new Date().getFullYear();

    const [invoices, solpeds, recurrent] = await Promise.all([
      InvoiceModel.find({ deleted: { $ne: true } })
        .select('issueDate netAmount amount status')
        .lean(),
      SolpedModel.find({ deleted: false })
        .select('accountingClass loanComponent paymentHistory paidAmount paidAt')
        .lean(),
      RecurrentPayableModel.find({ deleted: { $ne: true } })
        .select('accountingClass loanComponent paymentHistory paidAmount paidAt')
        .lean(),
    ]);

    const months = Array.from({ length: 12 }, (_, monthIndex) => ({
      month: monthIndex + 1,
      label: `${MONTHS_ES[monthIndex]} ${selectedYear}`,
      sales: 0,
      costOfSales: 0,
      grossProfit: 0,
      adminExpenses: 0,
      financialExpenses: 0,
      loansCapital: 0,
      loansInterest: 0,
      otherExpenses: 0,
      netIncome: 0,
    }));

    const byMonth = new Map(months.map((row) => [row.month, row]));

    invoices.forEach((invoice) => {
      const issueDate = parseDateOrNull(invoice.issueDate);
      if (!issueDate || issueDate.getFullYear() !== selectedYear) return;
      const month = issueDate.getMonth() + 1;
      const target = byMonth.get(month);
      if (!target) return;
      target.sales += toNumber(invoice.netAmount || invoice.amount);
    });

    const uncategorized = {
      count: 0,
      amount: 0,
    };

    const applyExpenseToMonth = (target, accountingClass, loanComponent, amount) => {
      if (accountingClass === 'COST_OF_SALES') {
        target.costOfSales += amount;
        return;
      }
      if (accountingClass === 'ADMIN_EXPENSE') {
        target.adminExpenses += amount;
        return;
      }
      if (accountingClass === 'FINANCIAL_EXPENSE') {
        target.financialExpenses += amount;
        return;
      }
      if (accountingClass === 'LOAN') {
        if (loanComponent === 'INTEREST') {
          target.financialExpenses += amount;
          target.loansInterest += amount;
        } else {
          target.loansCapital += amount;
        }
        return;
      }
      if (accountingClass === 'OTHER') {
        target.otherExpenses += amount;
        return;
      }

      uncategorized.count += 1;
      uncategorized.amount += amount;
    };

    const registerPayments = (rows) => {
      rows.forEach((row) => {
        const history = row.paymentHistory || [];
        history.forEach((payment) => {
          const paymentDate = parseDateOrNull(payment.paymentDate || payment.createdAt || row.paidAt);
          if (!paymentDate || paymentDate.getFullYear() !== selectedYear) return;
          const month = paymentDate.getMonth() + 1;
          const target = byMonth.get(month);
          if (!target) return;

          const snapshot = payment.accountingSnapshot || {};
          const accountingClass = String(snapshot.accountingClass || row.accountingClass || '').trim().toUpperCase();
          const loanComponent = String(snapshot.loanComponent || row.loanComponent || 'NONE').trim().toUpperCase();
          const amount = toNumber(payment.amount);

          if (amount <= 0) return;
          applyExpenseToMonth(target, accountingClass, loanComponent, amount);
        });
      });
    };

    registerPayments(solpeds);
    registerPayments(recurrent);

    months.forEach((row) => {
      row.grossProfit = row.sales - row.costOfSales;
      row.netIncome = row.grossProfit - row.adminExpenses - row.financialExpenses - row.otherExpenses;
    });

    const totals = months.reduce(
      (acc, row) => ({
        sales: acc.sales + row.sales,
        costOfSales: acc.costOfSales + row.costOfSales,
        grossProfit: acc.grossProfit + row.grossProfit,
        adminExpenses: acc.adminExpenses + row.adminExpenses,
        financialExpenses: acc.financialExpenses + row.financialExpenses,
        loansCapital: acc.loansCapital + row.loansCapital,
        loansInterest: acc.loansInterest + row.loansInterest,
        otherExpenses: acc.otherExpenses + row.otherExpenses,
        netIncome: acc.netIncome + row.netIncome,
      }),
      {
        sales: 0,
        costOfSales: 0,
        grossProfit: 0,
        adminExpenses: 0,
        financialExpenses: 0,
        loansCapital: 0,
        loansInterest: 0,
        otherExpenses: 0,
        netIncome: 0,
      },
    );

    return res.status(200).json({
      success: true,
      data: {
        year: selectedYear,
        monthly: months,
        totals,
        uncategorized,
      },
    });
  } catch (error) {
    console.error('[getFinancialStatement] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener estado financiero' });
  }
};

const getDashboard = async (req, res) => {
  try {
    const now = new Date();

    const [
      invoices,
      solpedPayables,
      trackingDocs,
    ] = await Promise.all([
      InvoiceModel.find({ deleted: { $ne: true } })
        .select('invoiceNumber pep client projectName description valuationNumber amount baseAmount igvAmount detraccionAmount netAmount currency issueDate dueDate status')
        .sort({ issueDate: -1 })
        .lean(),
      SolpedModel.find({ deleted: false, status: 'Aprobado' })
        .select('solpedNumber totalEstimado paidAmount paymentStatus createdAt recurrentCycleDate source recurrentConcept')
        .lean(),
      ProjectTrackingModel.find({ 'valuations.0': { $exists: true } })
        .select('valuations.invoiceIssued')
        .lean(),
    ]);

    const totalInvoiced = invoices.reduce((acc, row) => acc + toNumber(row.amount), 0);
    const totalCollectedAmount = invoices
      .filter((row) => row.status === 'Cobrado')
      .reduce((acc, row) => acc + toNumber(row.netAmount || row.amount), 0);

    const pendingInvoicesRows = invoices.filter((row) => row.status === 'Pendiente' || row.status === 'Vencido');
    const pendingReceivableAmount = pendingInvoicesRows.reduce((acc, row) => acc + toNumber(row.amount), 0);

    const payableRows = [
      ...solpedPayables.map((row) => ({
        reference: row.solpedNumber || 'SOLPED',
        amount: toNumber(row.totalEstimado),
        paidAmount: toNumber(row.paidAmount),
        currency: 'PEN',
        dueDate: row.recurrentCycleDate || row.createdAt,
        status: row.paymentStatus || 'Pendiente',
        source: 'SOLPED',
      })),
    ];

    const openPayablesRows = payableRows.filter((row) => row.status !== 'Pagado');
    const openPayablesAmount = openPayablesRows.reduce(
      (acc, row) => acc + Math.max(toNumber(row.amount) - toNumber(row.paidAmount), 0),
      0,
    );

    const payableStatusBuckets = payableRows.reduce(
      (acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      },
      { Pendiente: 0, Programado: 0, Parcial: 0, Pagado: 0 },
    );

    const monthlyRows = getLastMonths(6);
    const monthMap = new Map(monthlyRows.map((row) => [row.key, row]));

    invoices.forEach((row) => {
      const issueDate = parseDateOrNull(row.issueDate);
      if (!issueDate) return;
      const target = monthMap.get(getMonthKey(issueDate));
      if (target) {
        target.billed += toNumber(row.amount);
      }
    });

    payableRows.forEach((row) => {
      const dueDate = parseDateOrNull(row.dueDate);
      if (!dueDate) return;
      const target = monthMap.get(getMonthKey(dueDate));
      if (target) {
        target.payables += toNumber(row.amount);
      }
    });

    const pendingValuationCount = trackingDocs.reduce((acc, doc) => {
      const pending = (doc.valuations || []).filter((valuation) => !valuation.invoiceIssued).length;
      return acc + pending;
    }, 0);

    const pendingInvoiceRows = pendingInvoicesRows
      .sort((a, b) => new Date(a.dueDate || a.issueDate || 0).getTime() - new Date(b.dueDate || b.issueDate || 0).getTime())
      .slice(0, 10)
      .map((row) => ({
        invoiceNumber: row.invoiceNumber,
        pep: row.pep,
        client: row.client,
        amount: toNumber(row.amount),
        currency: row.currency || 'PEN',
        dueDate: row.dueDate || row.issueDate,
        status: row.status,
      }));

    const upcomingPayablesRows = openPayablesRows
      .sort((a, b) => new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime())
      .slice(0, 12)
      .map((row) => ({
        reference: row.reference,
        source: row.source,
        amount: toNumber(row.amount),
        currency: row.currency || 'PEN',
        dueDate: row.dueDate,
        status: row.status,
      }));

    const payableStatusSeries = Object.entries(payableStatusBuckets).map(([name, value]) => ({ name, value }));

    const monthlySeries = monthlyRows.map((row) => ({
      mes: row.mes,
      billed: toNumber(row.billed),
      payables: toNumber(row.payables),
      net: toNumber(row.billed) - toNumber(row.payables),
    }));

    const invoiceTaxRows = invoices
      .slice(0, 20)
      .map((row) => ({
        invoiceNumber: row.invoiceNumber,
        description: String(row.description || row.projectName || '').trim(),
        valuationName: `VAL-${String(toNumber(row.valuationNumber)).padStart(3, '0')}`,
        amount: toNumber(row.amount),
        igvAmount: toNumber(row.igvAmount),
        detraccionAmount: toNumber(row.detraccionAmount),
        netAmount: toNumber(row.netAmount || row.amount),
        currency: row.currency || 'PEN',
        issueDate: row.issueDate || null,
      }));

    const invoiceTaxChart = invoiceTaxRows.slice(0, 10).map((row) => ({
      invoiceNumber: row.invoiceNumber,
      amount: row.amount,
      igvAmount: row.igvAmount,
      detraccionAmount: row.detraccionAmount,
      netAmount: row.netAmount,
    }));

    return res.status(200).json({
      success: true,
      data: {
        totalInvoices: invoices.length,
        pendingInvoices: pendingInvoicesRows.length,
        totalInvoicedAmount: totalInvoiced,
        totalCollectedAmount,
        pendingReceivableAmount,
        openPayablesCount: openPayablesRows.length,
        openPayablesAmount,
        netFlow: totalInvoiced - openPayablesAmount,
        pendingValuationCount,
        monthlySeries,
        payableStatusSeries,
        pendingInvoiceRows,
        upcomingPayablesRows,
        invoiceTaxRows,
        invoiceTaxChart,
      },
    });
  } catch (error) {
    console.error('[getDashboard] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener dashboard de finanzas' });
  }
};

module.exports = {
  runRecurrentSolpedAutomation: ensureRecurrentSolpedsGenerated,
  getInvoiceCandidates,
  generateInvoiceFromValuation,
  getInvoices,
  updateInvoiceStatus,
  getPayables,
  createRecurrentPayable,
  getRecurrentPayables,
  toggleRecurrentPayableActive,
  updateRecurrentPayableStatus,
  updateSolpedPaymentStatus,
  updateRecurrentPayableById,
  deleteRecurrentPayableById,
  getPaymentsHistory,
  getAccountingCatalog,
  getFinancialStatement,
  getDashboard,
};
