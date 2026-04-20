const SolpedModel = require('../../../models/logistica/solped');
const SolpedCounterModel = require('../../../models/logistica/solped_counter');
const ComercialCBSModel = require('../../../models/comercial/comercial_CBS');
const ComercialModel = require('../../../models/comercial/comercial');

const AUTH_BYPASS = true;

const getApproverEmails = () =>
  (process.env.SOLPED_APPROVER_EMAILS || '')
    .split(',')
    .map((mail) => mail.trim().toLowerCase())
    .filter(Boolean);

const isApprover = (email) => {
  if (AUTH_BYPASS) return true;
  return getApproverEmails().includes(String(email || '').toLowerCase());
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

const extractPepFromElemento = (elementoPEP = '') => {
  const cleaned = String(elementoPEP || '').trim();
  if (!cleaned) return '';

  const match = cleaned.match(/^([^/]+\/[0-9]+)/);
  return match ? match[1] : '';
};

const mapItems = (items = []) =>
  items.map((item, index) => ({
    posicion: Number(item.posicion || (index + 1) * 10),
    pep: String(item.pep || '').trim(),
    elementoPEP: String(item.elementoPEP || '').trim(),
    material: String(item.material || '').trim(),
    descripcion: String(item.descripcion || '').trim(),
    cantidad: Number(item.cantidad || 0),
    unidad: String(item.unidad || '').trim(),
    precioEstimado: Number(item.precioEstimado || 0),
  }));

const getAdjudicadoPepSet = async () => {
  const peps = await ComercialModel.distinct('PEP', {
    deleted: { $ne: true },
    Estado: { $regex: '^\\s*adjudicado\\s*$', $options: 'i' },
    PEP: { $exists: true, $ne: '' },
  });

  return new Set(peps.map((pep) => String(pep || '').trim()).filter(Boolean));
};

const ensureItemsUseEnabledElement = async (items = []) => {
  const adjudicadoPepSet = await getAdjudicadoPepSet();
  const selectedPeps = [...new Set(items.map((item) => String(item.pep || '').trim()).filter(Boolean))];
  const invalidPep = selectedPeps.filter((pep) => !adjudicadoPepSet.has(pep));

  if (invalidPep.length > 0) {
    return {
      ok: false,
      message: `PEP no adjudicado: ${invalidPep.join(', ')}`,
    };
  }

  const elementos = [...new Set(items.map((item) => item.elementoPEP).filter(Boolean))];
  if (elementos.length === 0) {
    return { ok: false, message: 'Debe seleccionar al menos un elemento PEP' };
  }

  const enabledElements = await ComercialCBSModel.find({
    ElementoPEP: { $in: elementos },
    Carga: { $regex: '^\\s*si\\s*$', $options: 'i' },
    deleted: { $ne: true },
  })
    .select('ElementoPEP PEP')
    .lean();

  const elementPepMap = new Map();

  enabledElements.forEach((row) => {
    const elemento = String(row.ElementoPEP || '').trim();
    const pep = String(row.PEP || '').trim() || extractPepFromElemento(elemento);
    if (!elemento || !pep) return;

    if (!elementPepMap.has(elemento)) {
      elementPepMap.set(elemento, new Set());
    }

    elementPepMap.get(elemento).add(pep);
  });

  const invalid = items
    .filter((item) => {
      const pep = String(item.pep || '').trim();
      const elemento = String(item.elementoPEP || '').trim();
      const pepSet = elementPepMap.get(elemento);
      return !pepSet || !pepSet.has(pep);
    })
    .map((item) => String(item.elementoPEP || '').trim());

  if (invalid.length > 0) {
    return {
      ok: false,
      message: `Elemento PEP no habilitado para el PEP seleccionado: ${[...new Set(invalid)].join(', ')}`,
    };
  }

  return { ok: true };
};

const GetPepOptions = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const adjudicadoPepSet = await getAdjudicadoPepSet();

    if (adjudicadoPepSet.size === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const filter = {
      Carga: { $regex: '^\\s*si\\s*$', $options: 'i' },
      deleted: { $ne: true },
      ElementoPEP: { $exists: true, $ne: '' },
    };

    if (q) {
      filter.$or = [
        { PEP: { $regex: q, $options: 'i' } },
        { ElementoPEP: { $regex: q, $options: 'i' } },
        { Descripcion: { $regex: q, $options: 'i' } },
      ];
    }

    const rows = await ComercialCBSModel.find(filter)
      .select('PEP ElementoPEP Descripcion')
      .sort({ PEP: 1, ElementoPEP: 1 })
      .limit(5000)
      .lean();

    const pepList = [...new Set(rows
      .map((row) => String(row.PEP || '').trim() || extractPepFromElemento(row.ElementoPEP))
      .filter(Boolean))];

    const comercialRows = await ComercialModel.find({
      deleted: { $ne: true },
      PEP: { $in: pepList },
    })
      .select('PEP Descripcion Cliente')
      .lean();

    const pepMeta = new Map();
    comercialRows.forEach((row) => {
      const pep = String(row.PEP || '').trim();
      if (!pep || pepMeta.has(pep)) return;
      pepMeta.set(pep, {
        descripcion: String(row.Descripcion || '').trim(),
        cliente: String(row.Cliente || '').trim(),
      });
    });

    const map = new Map();

    rows.forEach((row) => {
      const pep = String(row.PEP || '').trim() || extractPepFromElemento(row.ElementoPEP);
      if (!adjudicadoPepSet.has(pep)) return;
      if (!pep) return;

      if (!map.has(pep)) {
        const meta = pepMeta.get(pep) || { descripcion: '', cliente: '' };
        map.set(pep, {
          pep,
          descripcion: meta.descripcion,
          cliente: meta.cliente,
          elementos: [],
        });
      }

      map.get(pep).elementos.push({
        elementoPEP: row.ElementoPEP,
        descripcion: row.Descripcion || '',
      });
    });

    return res.status(200).json({
      success: true,
      data: Array.from(map.values()),
    });
  } catch (error) {
    console.error('[GetPepOptions] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener PEPs' });
  }
};

const CreateSolped = async (req, res) => {
  try {
    const requesterEmail =
      String(req.body.requesterEmail || req.headers['x-user-email'] || '')
        .trim()
        .toLowerCase();

    const requesterName = String(req.body.requesterName || '').trim();

    if (!requesterEmail) {
      return res.status(400).json({ success: false, message: 'Email de solicitante requerido' });
    }

    const items = mapItems(req.body.items || []);
    if (items.length === 0) {
      return res.status(400).json({ success: false, message: 'Debe agregar al menos un item' });
    }

    const enabledValidation = await ensureItemsUseEnabledElement(items);
    if (!enabledValidation.ok) {
      return res.status(400).json({ success: false, message: enabledValidation.message });
    }

    const totalEstimado = items.reduce(
      (acc, item) => acc + (Number(item.cantidad) || 0) * (Number(item.precioEstimado) || 0),
      0,
    );

    const status = req.body.submit === true ? 'Pendiente Aprobacion' : 'Borrador';

    const solped = new SolpedModel({
      solpedNumber: await getNextSolpedNumber(),
      requesterName,
      requesterEmail,
      centro: String(req.body.centro || '').trim(),
      grupoCompra: String(req.body.grupoCompra || '').trim(),
      observaciones: String(req.body.observaciones || '').trim(),
      totalEstimado,
      status,
      items,
    });

    const saved = await solped.save();

    return res.status(201).json({
      success: true,
      message: status === 'Pendiente Aprobacion' ? 'SOLPED enviada a aprobación' : 'SOLPED guardada en borrador',
      data: saved,
    });
  } catch (error) {
    console.error('[CreateSolped] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al crear SOLPED' });
  }
};

const UpdateSolped = async (req, res) => {
  try {
    const { id } = req.params;
    const requesterEmail =
      String(req.body.requesterEmail || req.headers['x-user-email'] || '')
        .trim()
        .toLowerCase();

    const solped = await SolpedModel.findOne({ _id: id, deleted: false });
    if (!solped) {
      return res.status(404).json({ success: false, message: 'SOLPED no encontrada' });
    }

    if (solped.status === 'Aprobado') {
      return res.status(400).json({ success: false, message: 'No se puede editar una SOLPED aprobada' });
    }

    if (!AUTH_BYPASS && !isApprover(requesterEmail) && solped.requesterEmail !== requesterEmail) {
      return res.status(403).json({ success: false, message: 'No autorizado para editar esta SOLPED' });
    }

    const items = mapItems(req.body.items || []);
    if (items.length === 0) {
      return res.status(400).json({ success: false, message: 'Debe agregar al menos un item' });
    }

    const enabledValidation = await ensureItemsUseEnabledElement(items);
    if (!enabledValidation.ok) {
      return res.status(400).json({ success: false, message: enabledValidation.message });
    }

    const totalEstimado = items.reduce(
      (acc, item) => acc + (Number(item.cantidad) || 0) * (Number(item.precioEstimado) || 0),
      0,
    );

    const status = req.body.submit === true ? 'Pendiente Aprobacion' : 'Borrador';

    solped.requesterName = String(req.body.requesterName || solped.requesterName || '').trim();
    solped.requesterEmail = requesterEmail || solped.requesterEmail;
    solped.observaciones = String(req.body.observaciones || '').trim();
    solped.items = items;
    solped.totalEstimado = totalEstimado;
    solped.status = status;

    const saved = await solped.save();

    return res.status(200).json({
      success: true,
      message: status === 'Pendiente Aprobacion' ? 'SOLPED actualizada y enviada a aprobación' : 'SOLPED actualizada como borrador',
      data: saved,
    });
  } catch (error) {
    console.error('[UpdateSolped] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar SOLPED' });
  }
};

const GetSolpeds = async (req, res) => {
  try {
    const email = String(req.headers['x-user-email'] || req.query.email || '')
      .trim()
      .toLowerCase();

    const mine = String(req.query.mine || '').toLowerCase() === 'true';

    const filter = { deleted: false };

    if (!AUTH_BYPASS && (!isApprover(email) || mine)) {
      filter.requesterEmail = email;
    }

    const rows = await SolpedModel.find(filter).sort({ createdAt: -1 }).lean();

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[GetSolpeds] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener SOLPEDs' });
  }
};

const GetApprovalQueue = async (req, res) => {
  try {
    const email = String(req.headers['x-user-email'] || '').trim().toLowerCase();

    if (!AUTH_BYPASS && !isApprover(email)) {
      return res.status(403).json({ success: false, message: 'No autorizado para aprobar SOLPEDs' });
    }

    const rows = await SolpedModel.find({
      deleted: false,
      status: 'Pendiente Aprobacion',
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[GetApprovalQueue] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener cola de aprobación' });
  }
};

const ApproveSolped = async (req, res) => {
  try {
    const email = String(req.headers['x-user-email'] || '').trim().toLowerCase();

    if (!AUTH_BYPASS && !isApprover(email)) {
      return res.status(403).json({ success: false, message: 'No autorizado para aprobar SOLPEDs' });
    }

    const { id } = req.params;
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
          }
        : {
            status: 'Rechazado',
            rejectedBy: email,
            rejectedAt: new Date(),
            approvalComment: comment,
          };

    const row = await SolpedModel.findOneAndUpdate(
      { _id: id, status: 'Pendiente Aprobacion', deleted: false },
      update,
      { new: true },
    );

    if (!row) {
      return res.status(404).json({ success: false, message: 'SOLPED no encontrada o ya procesada' });
    }

    return res.status(200).json({
      success: true,
      message: action === 'approve' ? 'SOLPED aprobada' : 'SOLPED rechazada',
      data: row,
    });
  } catch (error) {
    console.error('[ApproveSolped] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al procesar aprobación' });
  }
};

const GetDashboard = async (req, res) => {
  try {
    const email = String(req.headers['x-user-email'] || '').trim().toLowerCase();
    const approver = AUTH_BYPASS ? true : isApprover(email);

    const baseFilter = { deleted: false };
    if (!approver) baseFilter.requesterEmail = email;

    const rows = await SolpedModel.find(baseFilter)
      .select('status totalEstimado createdAt items requesterEmail requesterName')
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

    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        mes: date.toLocaleDateString('es-PE', { month: 'short' }),
        cantidad: 0,
        monto: 0,
      };
    });

    const monthMap = new Map(months.map((m) => [m.key, m]));

    rows.forEach((row) => {
      const createdAt = new Date(row.createdAt);
      const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      const target = monthMap.get(key);
      if (target) {
        target.cantidad += 1;
        target.monto += Number(row.totalEstimado || 0);
      }
    });

    const pepMap = new Map();
    rows.forEach((row) => {
      (row.items || []).forEach((item) => {
        if (!item.pep) return;
        pepMap.set(item.pep, (pepMap.get(item.pep) || 0) + 1);
      });
    });

    const topPep = Array.from(pepMap.entries())
      .map(([pep, cantidad]) => ({ pep, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 8);

    return res.status(200).json({
      success: true,
      data: {
        total: rows.length,
        statusBuckets,
        monthly: months,
        topPep,
      },
    });
  } catch (error) {
    console.error('[GetDashboard] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener dashboard SOLPED' });
  }
};

module.exports = {
  GetPepOptions,
  CreateSolped,
  UpdateSolped,
  GetSolpeds,
  GetApprovalQueue,
  ApproveSolped,
  GetDashboard,
};
