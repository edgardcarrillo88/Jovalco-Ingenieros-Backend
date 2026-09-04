const PersonalModel = require('../../../models/administracion/personal');
const SeguridadPersonalModel = require('../../../models/seguridad/personal');
const SeguridadChecklistConfigModel = require('../../../models/seguridad/checklist_config');
const SeguridadChecklistCumplimientoModel = require('../../../models/seguridad/checklist_cumplimiento');
const SeguridadEventoModel = require('../../../models/seguridad/evento');
const SeguridadCatalogoModel = require('../../../models/seguridad/catalogo');
const SeguridadDocumentoModel = require('../../../models/seguridad/documento');
const mongoose = require('mongoose');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(n, 0) : 0; };

const calcularEstadoVencimiento = (fechaVenc) => {
  if (!fechaVenc) return 'Vigente';
  const hoy = new Date();
  const diff = Math.ceil((new Date(fechaVenc).getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'Vencido';
  if (diff <= 30) return 'Próximo a vencer';
  return 'Vigente';
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const [fichas, eventos, personalActivo] = await Promise.all([
      SeguridadPersonalModel.find().lean(),
      SeguridadEventoModel.find({ deleted: false }).lean(),
      PersonalModel.countDocuments({ deleted: false }),
    ]);

    const ahora = new Date();
    const añoActual = ahora.getFullYear();

    let examenesProximos = 0;
    let capacitacionesVencidas = 0;
    let totalEPP = 0;

    fichas.forEach((f) => {
      (f.examenesMedicos || []).forEach((e) => {
        if (calcularEstadoVencimiento(e.fechaVencimiento) === 'Próximo a vencer') examenesProximos++;
      });
      (f.capacitaciones || []).forEach((c) => {
        if (c.fecha && new Date(c.fecha) < ahora) capacitacionesVencidas++;
      });
      totalEPP += (f.entregasEPP || []).length;
    });

    const eventosAbiertos = eventos.filter((e) => e.estado !== 'Cerrado').length;
    const accidentesAño = eventos.filter((e) => e.tipo === 'Accidente' && new Date(e.fecha).getFullYear() === añoActual).length;
    const casiAccidentesAño = eventos.filter((e) => e.tipo === 'Casi accidente' && new Date(e.fecha).getFullYear() === añoActual).length;

    return res.status(200).json({
      success: true,
      data: {
        personalActivo,
        fichasActivas: fichas.length,
        examenesProximos,
        capacitacionesVencidas,
        totalEPP,
        eventosAbiertos,
        accidentesAño,
        casiAccidentesAño,
      },
    });
  } catch (error) {
    console.error('[seguridad:dashboard]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener dashboard' });
  }
};

// ─── Personal / Fichas ───────────────────────────────────────────────────────

const listFichas = async (req, res) => {
  try {
    const personal = await PersonalModel.find({ deleted: false })
      .select('nombres apellidos dni cargo area estado')
      .sort({ nombres: 1 })
      .lean();

    const fichas = await SeguridadPersonalModel.find().select('personalId examenesMedicos certificaciones capacitaciones entregasEPP habilitado').lean();
    const fichaMap = new Map(fichas.map((f) => [String(f.personalId), f]));

    const rows = personal.map((p) => {
      const f = fichaMap.get(String(p._id));
      return {
        _id: p._id,
        nombres: p.nombres,
        apellidos: p.apellidos,
        dni: p.dni,
        cargo: p.cargo,
        area: p.area,
        estado: p.estado,
        examenesCount: f?.examenesMedicos?.length || 0,
        certificacionesCount: f?.certificaciones?.length || 0,
        capacitacionesCount: f?.capacitaciones?.length || 0,
        eppCount: f?.entregasEPP?.length || 0,
        habilitado: f?.habilitado ?? true,
        tieneFicha: !!f,
      };
    });

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[seguridad:listFichas]', error.message);
    return res.status(500).json({ success: false, message: 'Error al listar fichas' });
  }
};

const getFicha = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID de personal inválido' });
    }

    // Coherencia con Administración: la ficha solo puede crearse para un
    // personal existente y activo.
    const personal = await PersonalModel.findOne({ _id: id, deleted: false }).lean();
    if (!personal) {
      return res.status(404).json({ success: false, message: 'Personal no encontrado en Administración' });
    }

    let ficha = await SeguridadPersonalModel.findOne({ personalId: id }).lean();
    if (!ficha) {
      ficha = await SeguridadPersonalModel.create({ personalId: id });
    }
    return res.status(200).json({ success: true, data: ficha });
  } catch (error) {
    console.error('[seguridad:getFicha]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener ficha' });
  }
};

// ─── Exámenes ────────────────────────────────────────────────────────────────

const addExamen = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const examen = {
      tipo: String(req.body.tipo || '').trim(),
      fechaRealizacion: new Date(req.body.fechaRealizacion),
      fechaVencimiento: req.body.fechaVencimiento ? new Date(req.body.fechaVencimiento) : null,
      estado: calcularEstadoVencimiento(req.body.fechaVencimiento),
      observaciones: String(req.body.observaciones || '').trim(),
      pep: String(req.body.pep || '').trim(),
    };
    if (!examen.tipo) return res.status(400).json({ success: false, message: 'Tipo de examen requerido' });

    const ficha = await SeguridadPersonalModel.findOneAndUpdate(
      { personalId: id },
      { $push: { examenesMedicos: examen } },
      { new: true },
    );
    if (!ficha) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
    return res.status(201).json({ success: true, data: ficha });
  } catch (error) {
    console.error('[seguridad:addExamen]', error.message);
    return res.status(500).json({ success: false, message: 'Error al agregar examen' });
  }
};

const updateExamen = async (req, res) => {
  try {
    const { id, examenIdx } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const idx = Number(examenIdx);
    const update = {};
    if (req.body.tipo !== undefined) update['examenesMedicos.' + idx + '.tipo'] = req.body.tipo;
    if (req.body.fechaRealizacion !== undefined) update['examenesMedicos.' + idx + '.fechaRealizacion'] = new Date(req.body.fechaRealizacion);
    if (req.body.fechaVencimiento !== undefined) {
      update['examenesMedicos.' + idx + '.fechaVencimiento'] = req.body.fechaVencimiento ? new Date(req.body.fechaVencimiento) : null;
      update['examenesMedicos.' + idx + '.estado'] = calcularEstadoVencimiento(req.body.fechaVencimiento);
    }
    if (req.body.observaciones !== undefined) update['examenesMedicos.' + idx + '.observaciones'] = String(req.body.observaciones || '');
    if (req.body.pep !== undefined) update['examenesMedicos.' + idx + '.pep'] = String(req.body.pep || '');

    const ficha = await SeguridadPersonalModel.findOneAndUpdate(
      { personalId: id },
      { $set: update },
      { new: true },
    );
    if (!ficha) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
    return res.status(200).json({ success: true, data: ficha });
  } catch (error) {
    console.error('[seguridad:updateExamen]', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar examen' });
  }
};

// ─── Certificaciones ─────────────────────────────────────────────────────────

const addCertificacion = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const cert = {
      tipo: String(req.body.tipo || '').trim(),
      fechaEmision: new Date(req.body.fechaEmision),
      fechaVencimiento: req.body.fechaVencimiento ? new Date(req.body.fechaVencimiento) : null,
      estado: calcularEstadoVencimiento(req.body.fechaVencimiento),
      observaciones: String(req.body.observaciones || '').trim(),
      pep: String(req.body.pep || '').trim(),
    };
    if (!cert.tipo) return res.status(400).json({ success: false, message: 'Tipo de certificación requerido' });

    const ficha = await SeguridadPersonalModel.findOneAndUpdate(
      { personalId: id },
      { $push: { certificaciones: cert } },
      { new: true },
    );
    if (!ficha) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
    return res.status(201).json({ success: true, data: ficha });
  } catch (error) {
    console.error('[seguridad:addCertificacion]', error.message);
    return res.status(500).json({ success: false, message: 'Error al agregar certificación' });
  }
};

const updateCertificacion = async (req, res) => {
  try {
    const { id, certIdx } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const idx = Number(certIdx);
    const update = {};
    if (req.body.tipo !== undefined) update['certificaciones.' + idx + '.tipo'] = req.body.tipo;
    if (req.body.fechaEmision !== undefined) update['certificaciones.' + idx + '.fechaEmision'] = new Date(req.body.fechaEmision);
    if (req.body.fechaVencimiento !== undefined) {
      update['certificaciones.' + idx + '.fechaVencimiento'] = req.body.fechaVencimiento ? new Date(req.body.fechaVencimiento) : null;
      update['certificaciones.' + idx + '.estado'] = calcularEstadoVencimiento(req.body.fechaVencimiento);
    }
    if (req.body.observaciones !== undefined) update['certificaciones.' + idx + '.observaciones'] = String(req.body.observaciones || '');
    if (req.body.pep !== undefined) update['certificaciones.' + idx + '.pep'] = String(req.body.pep || '');

    const ficha = await SeguridadPersonalModel.findOneAndUpdate({ personalId: id }, { $set: update }, { new: true });
    if (!ficha) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
    return res.status(200).json({ success: true, data: ficha });
  } catch (error) {
    console.error('[seguridad:updateCertificacion]', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar certificación' });
  }
};

// ─── Capacitaciones ──────────────────────────────────────────────────────────

const addCapacitacion = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const cap = {
      curso: String(req.body.curso || '').trim(),
      tipo: String(req.body.tipo || '').trim(),
      fecha: req.body.fecha ? new Date(req.body.fecha) : null,
      instructor: String(req.body.instructor || '').trim(),
      horas: toNum(req.body.horas),
      proyecto: String(req.body.proyecto || '').trim(),
      documento: String(req.body.documento || '').trim(),
      observaciones: String(req.body.observaciones || '').trim(),
    };
    if (!cap.curso) return res.status(400).json({ success: false, message: 'Curso requerido' });

    const ficha = await SeguridadPersonalModel.findOneAndUpdate(
      { personalId: id },
      { $push: { capacitaciones: cap } },
      { new: true },
    );
    if (!ficha) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
    return res.status(201).json({ success: true, data: ficha });
  } catch (error) {
    console.error('[seguridad:addCapacitacion]', error.message);
    return res.status(500).json({ success: false, message: 'Error al agregar capacitación' });
  }
};

// ─── EPP ─────────────────────────────────────────────────────────────────────

const addEntregaEPP = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const epp = {
      tipoEPP: String(req.body.tipoEPP || '').trim(),
      fecha: req.body.fecha ? new Date(req.body.fecha) : new Date(),
      cantidad: toNum(req.body.cantidad) || 1,
      responsable: String(req.body.responsable || '').trim(),
      observaciones: String(req.body.observaciones || '').trim(),
      pep: String(req.body.pep || '').trim(),
    };
    if (!epp.tipoEPP) return res.status(400).json({ success: false, message: 'Tipo de EPP requerido' });

    const ficha = await SeguridadPersonalModel.findOneAndUpdate(
      { personalId: id },
      { $push: { entregasEPP: epp } },
      { new: true },
    );
    if (!ficha) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
    return res.status(201).json({ success: true, data: ficha });
  } catch (error) {
    console.error('[seguridad:addEntregaEPP]', error.message);
    return res.status(500).json({ success: false, message: 'Error al registrar entrega EPP' });
  }
};

const getUltimasEntregasEPP = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const ficha = await SeguridadPersonalModel.findOne({ personalId: id }).lean();
    if (!ficha) return res.status(200).json({ success: true, data: [] });

    const agrupado = {};
    (ficha.entregasEPP || []).forEach((e) => {
      if (!agrupado[e.tipoEPP]) agrupado[e.tipoEPP] = { tipoEPP: e.tipoEPP, total: 0, ultima: e, historial: [] };
      agrupado[e.tipoEPP].total += e.cantidad;
      if (!agrupado[e.tipoEPP].ultima || new Date(e.fecha) > new Date(agrupado[e.tipoEPP].ultima.fecha)) agrupado[e.tipoEPP].ultima = e;
      agrupado[e.tipoEPP].historial.push(e);
    });

    return res.status(200).json({ success: true, data: Object.values(agrupado) });
  } catch (error) {
    console.error('[seguridad:getUltimasEntregasEPP]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener entregas EPP' });
  }
};

// ─── Documentos (catálogo maestro) ───────────────────────────────────────────

const listDocumentos = async (req, res) => {
  try {
    const soloActivos = String(req.query.activos || 'false').toLowerCase() === 'true';
    const filter = { deleted: false };
    if (soloActivos) filter.activo = true;
    const rows = await SeguridadDocumentoModel.find(filter).sort({ categoria: 1, nombre: 1 }).lean();
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[seguridad:listDocumentos]', error.message);
    return res.status(500).json({ success: false, message: 'Error al listar documentos' });
  }
};

const createDocumento = async (req, res) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    const categoria = String(req.body.categoria || '').trim();
    if (!nombre || !categoria) return res.status(400).json({ success: false, message: 'Nombre y categoría requeridos' });
    const doc = await SeguridadDocumentoModel.create({ nombre, categoria, descripcion: String(req.body.descripcion || '').trim() });
    return res.status(201).json({ success: true, data: doc });
  } catch (error) {
    console.error('[seguridad:createDocumento]', error.message);
    return res.status(500).json({ success: false, message: 'Error al crear documento' });
  }
};

const updateDocumento = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const update = {};
    if (req.body.nombre !== undefined) update.nombre = String(req.body.nombre).trim();
    if (req.body.categoria !== undefined) update.categoria = String(req.body.categoria).trim();
    if (req.body.descripcion !== undefined) update.descripcion = String(req.body.descripcion).trim();
    if (req.body.activo !== undefined) update.activo = Boolean(req.body.activo);
    if (Object.keys(update).length === 0) return res.status(400).json({ success: false, message: 'Sin campos' });
    const doc = await SeguridadDocumentoModel.findOneAndUpdate({ _id: id, deleted: false }, { $set: update }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Documento no encontrado' });
    return res.status(200).json({ success: true, data: doc });
  } catch (error) {
    console.error('[seguridad:updateDocumento]', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar documento' });
  }
};

// ─── Checklist ───────────────────────────────────────────────────────────────

const getChecklistConfig = async (req, res) => {
  try {
    const pep = String(req.query.pep || '').trim();
    if (!pep) return res.status(400).json({ success: false, message: 'PEP requerido' });
    const config = await SeguridadChecklistConfigModel.findOne({ pep }).populate('items.documentoId', 'nombre categoria').populate('personalAsignado', 'nombres apellidos dni').lean();
    return res.status(200).json({ success: true, data: config || { pep, items: [], personalAsignado: [] } });
  } catch (error) {
    console.error('[seguridad:getChecklistConfig]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener configuración' });
  }
};

const saveChecklistConfig = async (req, res) => {
  try {
    const pep = String(req.body.pep || '').trim();
    const items = (req.body.items || []).filter((i) => i.documentoId);
    if (!pep) return res.status(400).json({ success: false, message: 'PEP requerido' });
    const config = await SeguridadChecklistConfigModel.findOneAndUpdate(
      { pep }, { $set: { items } }, { upsert: true, new: true },
    );
    return res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error('[seguridad:saveChecklistConfig]', error.message);
    return res.status(500).json({ success: false, message: 'Error al guardar configuración' });
  }
};

const getResumenTodosChecklist = async (req, res) => {
  try {
    const configs = await SeguridadChecklistConfigModel.find()
      .populate('items.documentoId', 'nombre categoria')
      .populate('personalAsignado', 'nombres apellidos dni')
      .sort({ pep: 1 })
      .lean();
    const rows = configs.map((c) => ({
      pep: c.pep,
      documentosRequeridos: c.items.filter((i) => i.requerido).map((i) => i.documentoId?.nombre || '—').join(', '),
      cantidadDocumentos: c.items.filter((i) => i.requerido).length,
      personalCount: (c.personalAsignado || []).length,
    }));
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[seguridad:getResumenTodosChecklist]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener resumen' });
  }
};

const asignarPersonalAPEP = async (req, res) => {
  try {
    const pep = String(req.body.pep || '').trim();
    const personalIds = (req.body.personalIds || []).filter(Boolean);
    if (!pep || personalIds.length === 0) return res.status(400).json({ success: false, message: 'PEP y personalIds requeridos' });

    const config = await SeguridadChecklistConfigModel.findOne({ pep });
    if (!config) return res.status(404).json({ success: false, message: 'Configuración no encontrada. Configure documentos primero.' });

    // Agregar personal al array
    const existentes = new Set((config.personalAsignado || []).map(String));
    personalIds.forEach((pid) => existentes.add(pid));
    config.personalAsignado = Array.from(existentes);
    await config.save();

    // Crear cumplimientos vacíos para cada trabajador con los docs requeridos
    for (const personalId of personalIds) {
      const exists = await SeguridadChecklistCumplimientoModel.findOne({ pep, personalId });
      if (!exists) {
        const items = config.items.filter((i) => i.requerido).map((i) => ({
          documentoId: i.documentoId,
          estado: 'Pendiente',
        }));
        await SeguridadChecklistCumplimientoModel.create({ pep, personalId, items, porcentaje: 0 });
      }
    }

    return res.status(200).json({ success: true, message: `${personalIds.length} trabajador(es) asignado(s)` });
  } catch (error) {
    console.error('[seguridad:asignarPersonalAPEP]', error.message);
    return res.status(500).json({ success: false, message: 'Error al asignar personal' });
  }
};

const getCumplimiento = async (req, res) => {
  try {
    const pep = String(req.query.pep || '').trim();
    const personalId = String(req.query.personalId || '').trim();
    if (!pep || !personalId) return res.status(400).json({ success: false, message: 'PEP y personalId requeridos' });
    const cumpl = await SeguridadChecklistCumplimientoModel.findOne({ pep, personalId }).populate('items.documentoId', 'nombre categoria').lean();
    return res.status(200).json({ success: true, data: cumpl || { pep, personalId, items: [], porcentaje: 0 } });
  } catch (error) {
    console.error('[seguridad:getCumplimiento]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener cumplimiento' });
  }
};

const saveCumplimiento = async (req, res) => {
  try {
    const pep = String(req.body.pep || '').trim();
    const personalId = String(req.body.personalId || '').trim();
    const items = req.body.items || [];
    if (!pep || !personalId) return res.status(400).json({ success: false, message: 'PEP y personalId requeridos' });

    // Calcular estado automático para items con fecha de vencimiento
    const itemsProcesados = items.map((item) => {
      if (item.fechaVencimiento) {
        const estado = calcularEstadoVencimiento(item.fechaVencimiento);
        return { ...item, estado };
      }
      return { ...item, estado: item.estado || 'Pendiente' };
    });

    const cumplidos = itemsProcesados.filter((i) => i.estado === 'Vigente').length;
    const totalRequeridos = itemsProcesados.filter((i) => i.estado !== 'NA').length;
    const porcentaje = totalRequeridos > 0 ? Math.round((cumplidos / totalRequeridos) * 100) : 0;

    const cumpl = await SeguridadChecklistCumplimientoModel.findOneAndUpdate(
      { pep, personalId },
      { $set: { items: itemsProcesados, porcentaje } },
      { upsert: true, new: true },
    );
    return res.status(200).json({ success: true, data: cumpl });
  } catch (error) {
    console.error('[seguridad:saveCumplimiento]', error.message);
    return res.status(500).json({ success: false, message: 'Error al guardar cumplimiento' });
  }
};

const getResumenChecklist = async (req, res) => {
  try {
    const pep = String(req.query.pep || '').trim();
    const page = Math.max(toNum(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(toNum(req.query.pageSize) || 50, 1), 200);

    if (!pep) return res.status(400).json({ success: false, message: 'PEP requerido' });

    const config = await SeguridadChecklistConfigModel.findOne({ pep }).populate('items.documentoId', 'nombre categoria').lean();
    if (!config || !config.items || config.items.length === 0) {
      return res.status(200).json({ success: true, data: { rows: [], columnas: [], pagination: { page, pageSize, total: 0, totalPages: 1 } } });
    }

    const docsRequeridos = config.items.filter((i) => i.requerido);
    const columnas = docsRequeridos.map((d) => ({ docId: String(d.documentoId?._id || d.documentoId), nombre: d.documentoId?.nombre || 'Doc' }));

    // Personal asignado
    const personalIds = config.personalAsignado || [];
    const total = personalIds.length;
    const personal = await PersonalModel.find({ _id: { $in: personalIds }, deleted: false })
      .select('_id nombres apellidos dni')
      .sort({ nombres: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    const idsSubset = personal.map((p) => p._id);
    const cumplimientos = await SeguridadChecklistCumplimientoModel.find({ pep, personalId: { $in: idsSubset } }).lean();
    const cumplMap = new Map(cumplimientos.map((c) => [String(c.personalId), c]));

    const rows = personal.map((p) => {
      const cumpl = cumplMap.get(String(p._id));
      const itemsMap = new Map((cumpl?.items || []).map((i) => [String(i.documentoId), i]));
      const itemsRow = {};
      let docsVigentes = 0;
      columnas.forEach((col) => {
        const estado = itemsMap.get(col.docId);
        itemsRow[col.nombre] = estado?.estado || 'Pendiente';
        if (estado?.estado === 'Vigente') docsVigentes++;
      });
      // Porcentaje real de cumplimiento del trabajador.
      const porcentaje = columnas.length > 0 ? Math.round((docsVigentes / columnas.length) * 100) : 0;
      return { personalId: p._id, nombres: p.nombres, apellidos: p.apellidos, dni: p.dni, items: itemsRow, porcentaje };
    });

    return res.status(200).json({ success: true, data: { rows, columnas, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } });
  } catch (error) {
    console.error('[seguridad:getResumenChecklist]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener resumen' });
  }
};

// ─── Eventos ─────────────────────────────────────────────────────────────────

const listEventos = async (req, res) => {
  try {
    const page = Math.max(toNum(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(toNum(req.query.pageSize) || 20, 1), 100);
    const filtroPep = String(req.query.pep || '').trim();
    const filtroTipo = String(req.query.tipo || '').trim();
    const filtroEstado = String(req.query.estado || '').trim();

    const filter = { deleted: false };
    if (filtroPep) filter.pep = filtroPep;
    if (filtroTipo) filter.tipo = filtroTipo;
    if (filtroEstado) filter.estado = filtroEstado;

    const total = await SeguridadEventoModel.countDocuments(filter);
    const rows = await SeguridadEventoModel.find(filter)
      .populate('personalId', 'nombres apellidos dni')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    return res.status(200).json({
      success: true,
      data: { rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } },
    });
  } catch (error) {
    console.error('[seguridad:listEventos]', error.message);
    return res.status(500).json({ success: false, message: 'Error al listar eventos' });
  }
};

const createEvento = async (req, res) => {
  try {
    // Generar código autoincremental
    const last = await SeguridadEventoModel.findOne().sort({ createdAt: -1 }).select('codigo').lean();
    const seq = last ? parseInt((last.codigo || 'EVT-0').split('-')[1] || '0', 10) + 1 : 1;
    const codigo = `EVT-${String(seq).padStart(4, '0')}`;

    const evento = await SeguridadEventoModel.create({
      codigo,
      fecha: req.body.fecha ? new Date(req.body.fecha) : new Date(),
      pep: String(req.body.pep || '').trim(),
      area: String(req.body.area || '').trim(),
      lugar: String(req.body.lugar || '').trim(),
      personalId: req.body.personalId || null,
      tipo: String(req.body.tipo || '').trim(),
      descripcion: String(req.body.descripcion || '').trim(),
      criticidad: String(req.body.criticidad || 'Media').trim(),
      estado: String(req.body.estado || 'Abierto').trim(),
      evidencias: String(req.body.evidencias || '').trim(),
      responsable: String(req.body.responsable || '').trim(),
    });

    return res.status(201).json({ success: true, data: evento });
  } catch (error) {
    console.error('[seguridad:createEvento]', error.message);
    return res.status(500).json({ success: false, message: 'Error al crear evento' });
  }
};

const updateEvento = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const allowed = ['fecha', 'pep', 'area', 'lugar', 'personalId', 'tipo', 'descripcion', 'criticidad', 'estado', 'evidencias', 'responsable'];
    const update = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    });

    // Si intenta cerrar, validar acciones pendientes
    if (update.estado === 'Cerrado') {
      const evento = await SeguridadEventoModel.findOne({ _id: id, deleted: false }).lean();
      if (evento && (evento.accionesCorrectivas || []).some((a) => a.estado !== 'Completada')) {
        return res.status(400).json({ success: false, message: 'No se puede cerrar el evento mientras existan acciones correctivas pendientes' });
      }
    }

    const evento = await SeguridadEventoModel.findOneAndUpdate(
      { _id: id, deleted: false },
      { $set: update },
      { new: true },
    );
    if (!evento) return res.status(404).json({ success: false, message: 'Evento no encontrado' });
    return res.status(200).json({ success: true, data: evento });
  } catch (error) {
    console.error('[seguridad:updateEvento]', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar evento' });
  }
};

const addAccionCorrectiva = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const accion = {
      accion: String(req.body.accion || '').trim(),
      responsable: String(req.body.responsable || '').trim(),
      fechaCompromiso: req.body.fechaCompromiso ? new Date(req.body.fechaCompromiso) : null,
      estado: String(req.body.estado || 'Pendiente').trim(),
      evidencias: String(req.body.evidencias || '').trim(),
      comentarios: String(req.body.comentarios || '').trim(),
    };
    if (!accion.accion) return res.status(400).json({ success: false, message: 'Acción requerida' });

    const evento = await SeguridadEventoModel.findOneAndUpdate(
      { _id: id, deleted: false },
      { $push: { accionesCorrectivas: accion } },
      { new: true },
    );
    if (!evento) return res.status(404).json({ success: false, message: 'Evento no encontrado' });
    return res.status(201).json({ success: true, data: evento });
  } catch (error) {
    console.error('[seguridad:addAccionCorrectiva]', error.message);
    return res.status(500).json({ success: false, message: 'Error al agregar acción correctiva' });
  }
};

const updateAccionCorrectiva = async (req, res) => {
  try {
    const { id, accIdx } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const idx = Number(accIdx);
    const update = {};
    if (req.body.accion !== undefined) update['accionesCorrectivas.' + idx + '.accion'] = req.body.accion;
    if (req.body.responsable !== undefined) update['accionesCorrectivas.' + idx + '.responsable'] = req.body.responsable;
    if (req.body.fechaCompromiso !== undefined) update['accionesCorrectivas.' + idx + '.fechaCompromiso'] = req.body.fechaCompromiso ? new Date(req.body.fechaCompromiso) : null;
    if (req.body.estado !== undefined) update['accionesCorrectivas.' + idx + '.estado'] = req.body.estado;
    if (req.body.evidencias !== undefined) update['accionesCorrectivas.' + idx + '.evidencias'] = req.body.evidencias;
    if (req.body.comentarios !== undefined) update['accionesCorrectivas.' + idx + '.comentarios'] = req.body.comentarios;

    const evento = await SeguridadEventoModel.findOneAndUpdate({ _id: id, deleted: false }, { $set: update }, { new: true });
    if (!evento) return res.status(404).json({ success: false, message: 'Evento no encontrado' });
    return res.status(200).json({ success: true, data: evento });
  } catch (error) {
    console.error('[seguridad:updateAccionCorrectiva]', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar acción correctiva' });
  }
};

// ─── Catálogos ───────────────────────────────────────────────────────────────

const listCatalogo = async (req, res) => {
  try {
    const { tipo } = req.params;
    if (!tipo) return res.status(400).json({ success: false, message: 'Tipo de catálogo requerido' });
    const rows = await SeguridadCatalogoModel.find({ tipoCat: tipo }).sort({ orden: 1 }).lean();
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[seguridad:listCatalogo]', error.message);
    return res.status(500).json({ success: false, message: 'Error al listar catálogo' });
  }
};

const createCatalogo = async (req, res) => {
  try {
    const tipoCat = String(req.body.tipoCat || '').trim();
    const valor = String(req.body.valor || '').trim();
    if (!tipoCat || !valor) return res.status(400).json({ success: false, message: 'tipoCat y valor requeridos' });

    const item = await SeguridadCatalogoModel.create({ tipoCat, valor, orden: toNum(req.body.orden) });
    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error('[seguridad:createCatalogo]', error.message);
    return res.status(500).json({ success: false, message: 'Error al crear catálogo' });
  }
};

module.exports = {
  getDashboard,
  listFichas, getFicha,
  addExamen, updateExamen,
  addCertificacion, updateCertificacion,
  addCapacitacion,
  addEntregaEPP, getUltimasEntregasEPP,
  listDocumentos, createDocumento, updateDocumento,
  getChecklistConfig, saveChecklistConfig,
  getResumenTodosChecklist, asignarPersonalAPEP,
  getCumplimiento, saveCumplimiento, getResumenChecklist,
  listEventos, createEvento, updateEvento,
  addAccionCorrectiva, updateAccionCorrectiva,
  listCatalogo, createCatalogo,
};
