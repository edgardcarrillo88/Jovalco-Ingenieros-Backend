const InventoryItemModel = require('../../../models/almacen/item');
const InventoryStockModel = require('../../../models/almacen/stock');
const InventoryMovementModel = require('../../../models/almacen/movement');
const InventoryCategoryModel = require('../../../models/almacen/category');
const ComercialModel = require('../../../models/comercial/comercial');
const mongoose = require('mongoose');

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(n, 0) : 0;
};

/**
 * Obtiene el email del usuario autenticado.
 * Fuente principal: el token JWT validado (req.user.email). El header
 * x-user-email o el body solo se usan como respaldo para procesos internos.
 */
const getEmail = (req) =>
  String(
    req.user?.email ||
      req.headers['x-user-email'] ||
      req.body?.usuario ||
      'sistema',
  )
    .trim()
    .toLowerCase();

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Valida que un PEP exista y esté adjudicado en el módulo Comercial.
 * Interacción Almacén ↔ Comercial: los movimientos con destino PEP deben
 * apuntar a un proyecto adjudicado (misma regla que usa Logística).
 */
const ensurePepAdjudicado = async (pep) => {
  const pepLimpio = String(pep || '').trim();
  if (!pepLimpio) return false;

  const found = await ComercialModel.findOne({
    deleted: { $ne: true },
    PEP: pepLimpio,
    Estado: { $regex: '^\\s*adjudicado\\s*$', $options: 'i' },
  })
    .select('_id')
    .lean();

  return Boolean(found);
};

// ─── Categorías ──────────────────────────────────────────────────────────────

const listCategories = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const filter = { deleted: false };
    if (q) filter.nombre = { $regex: q, $options: 'i' };

    const rows = await InventoryCategoryModel.find(filter)
      .select('nombre costoUnitario personalizada')
      .sort({ nombre: 1 })
      .lean();

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[almacen:listCategories]', error.message);
    return res.status(500).json({ success: false, message: 'Error al listar categorías' });
  }
};

const createCategory = async (req, res) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ success: false, message: 'Nombre de categoría requerido' });

    const costoUnitario = toNumber(req.body.costoUnitario);
    const exists = await InventoryCategoryModel.findOne({ nombre, deleted: false }).lean();
    if (exists) return res.status(400).json({ success: false, message: 'La categoría ya existe' });

    const category = await InventoryCategoryModel.create({ nombre, costoUnitario, personalizada: true });
    return res.status(201).json({ success: true, data: category });
  } catch (error) {
    console.error('[almacen:createCategory]', error.message);
    return res.status(500).json({ success: false, message: 'Error al crear categoría' });
  }
};

// ─── Items ───────────────────────────────────────────────────────────────────

const listItems = async (req, res) => {
  try {
    const categoria = String(req.query.categoria || '').trim();
    const tipo = String(req.query.tipo || '').trim();
    const search = String(req.query.search || '').trim();
    const filter = { deleted: false };
    if (categoria) filter.categoria = categoria;
    if (tipo) filter.tipo = tipo;
    if (search) {
      // Búsqueda por nombre o código.
      filter.$or = [
        { nombre: { $regex: search, $options: 'i' } },
        { codigo: { $regex: search, $options: 'i' } },
      ];
    }

    const rows = await InventoryItemModel.find(filter).sort({ nombre: 1 }).lean();
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[almacen:listItems]', error.message);
    return res.status(500).json({ success: false, message: 'Error al listar items' });
  }
};

const createItem = async (req, res) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ success: false, message: 'Nombre del item requerido' });

    const codigo = String(req.body.codigo || '').trim();
    const categoria = String(req.body.categoria || '').trim();
    if (!categoria) return res.status(400).json({ success: false, message: 'Categoría requerida' });

    // Evitar duplicados (mismo nombre o mismo código) entre items no eliminados.
    const duplicado = await InventoryItemModel.findOne({
      deleted: false,
      $or: [
        { nombre },
        ...(codigo ? [{ codigo }] : []),
      ],
    }).lean();
    if (duplicado) {
      return res.status(400).json({
        success: false,
        message: duplicado.nombre === nombre
          ? `Ya existe un item con el nombre "${nombre}"`
          : `Ya existe un item con el código "${codigo}"`,
      });
    }

    const catExists = await InventoryCategoryModel.findOne({ nombre: categoria, deleted: false }).lean();
    if (!catExists) {
      await InventoryCategoryModel.create({ nombre: categoria, costoUnitario: 0, personalizada: true });
    }

    const item = await InventoryItemModel.create({
      codigo,
      nombre,
      categoria,
      tipo: String(req.body.tipo || 'Componente').trim(),
      costoUnitario: toNumber(req.body.costoUnitario),
      stockSeguridad: toNumber(req.body.stockSeguridad),
      fechaCalibracion: req.body.fechaCalibracion || null,
      duracionCalibracionMeses: toNumber(req.body.duracionCalibracionMeses),
    });

    await InventoryStockModel.create({ itemId: item._id });
    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error('[almacen:createItem]', error.message);
    return res.status(500).json({ success: false, message: 'Error al crear item' });
  }
};

const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Id de item inválido' });

    const allowed = [
      'codigo', 'nombre', 'categoria', 'tipo',
      'costoUnitario', 'stockSeguridad',
      'fechaCalibracion', 'duracionCalibracionMeses',
    ];

    const update = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    });

    if (Object.keys(update).length === 0) return res.status(400).json({ success: false, message: 'No hay campos para actualizar' });

    const item = await InventoryItemModel.findOneAndUpdate(
      { _id: id, deleted: false },
      { $set: update },
      { new: true },
    );
    if (!item) return res.status(404).json({ success: false, message: 'Item no encontrado' });

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    console.error('[almacen:updateItem]', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar item' });
  }
};

// ─── Stock ───────────────────────────────────────────────────────────────────

const getStock = async (req, res) => {
  try {
    const categoria = String(req.query.categoria || '').trim();
    const page = Math.max(toNumber(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(toNumber(req.query.pageSize) || 50, 1), 200);

    const pipeline = [
      { $lookup: { from: 'InventoryItem', localField: 'itemId', foreignField: '_id', as: '_item' } },
      { $unwind: { path: '$_item', preserveNullAndEmptyArrays: false } },
      { $match: { '_item.deleted': false } },
      { $addFields: {
        itemNombre: '$_item.nombre',
        itemCodigo: '$_item.codigo',
        itemCategoria: '$_item.categoria',
        itemTipo: '$_item.tipo',
        itemCostoUnitario: '$_item.costoUnitario',
        itemStockSeguridad: '$_item.stockSeguridad',
        itemFechaCalibracion: '$_item.fechaCalibracion',
        itemDuracionCalibracionMeses: '$_item.duracionCalibracionMeses',
        ultimoComentario: { $ifNull: ['$ultimoComentario', ''] },
      }},
      { $sort: { itemCategoria: 1, itemNombre: 1 } },
    ];

    if (categoria) pipeline.unshift({ $match: { '_item.categoria': categoria } });

    const countResult = await InventoryStockModel.aggregate([...pipeline, { $count: 'total' }]);
    const total = countResult[0]?.total || 0;
    const skip = (page - 1) * pageSize;

    const rows = await InventoryStockModel.aggregate([...pipeline, { $skip: skip }, { $limit: pageSize }]);

    // Obtener costoUnitarioBase desde InventoryCategory
    const catNames = [...new Set(rows.map((r) => r.itemCategoria).filter(Boolean))];
    const cats = await InventoryCategoryModel.find({ nombre: { $in: catNames }, deleted: false })
      .select('nombre costoUnitario')
      .lean();
    const catCostoMap = new Map(cats.map((c) => [c.nombre, c.costoUnitario || 0]));

    const grouped = rows.reduce((acc, row) => {
      const cat = row.itemCategoria || 'Sin categoría';
      if (!acc[cat]) acc[cat] = { categoria: cat, items: [], subtotal: 0, totalBase: 0 };
      const costoBase = catCostoMap.get(cat) || 0;
      const totalUnitarioBase = (row.cantidad || 0) * costoBase;
      acc[cat].items.push({
        _id: row._id,
        itemId: row.itemId,
        codigo: row.itemCodigo,
        nombre: row.itemNombre,
        tipo: row.itemTipo,
        cantidad: row.cantidad || 0,
        montoTotalIngreso: row.montoTotalIngreso || 0,
        costoUnitarioActual: row.costoUnitarioActual || 0,
        costoUnitarioConfig: costoBase,
        totalUnitarioBase,
        stockSeguridad: row.itemStockSeguridad || 0,
        ultimoComentario: row.ultimoComentario || '',
        fechaCalibracion: row.itemFechaCalibracion,
        duracionCalibracionMeses: row.itemDuracionCalibracionMeses,
      });
      acc[cat].subtotal += row.montoTotalIngreso || 0;
      acc[cat].totalBase += totalUnitarioBase;
      return acc;
    }, {});

    const grupos = Object.values(grouped);
    const totalMonto = grupos.reduce((s, g) => s + g.subtotal, 0);

    return res.status(200).json({
      success: true,
      data: {
        grupos,
        totalItems: rows.length,
        totalMonto,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  } catch (error) {
    console.error('[almacen:getStock]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener stock' });
  }
};

// ─── Movimientos (Ingreso / Salida) ──────────────────────────────────────────

const registerIngreso = async (req, res) => {
  try {
    const itemId = String(req.body.itemId || '').trim();
    const cantidad = toNumber(req.body.cantidad);
    const monto = toNumber(req.body.monto);
    const costoUnitarioActual = toNumber(req.body.costoUnitarioActual);
    const destino = String(req.body.destino || 'ALMACEN').trim().toUpperCase();
    const destinoRef = String(req.body.destinoRef || (destino === 'ALMACEN' ? 'ALMACEN' : '')).trim();
    const comentarios = String(req.body.comentarios || '').trim();
    const usuario = getEmail(req);

    if (!itemId || cantidad <= 0) return res.status(400).json({ success: false, message: 'Item y cantidad > 0 requeridos' });
    if (destino !== 'ALMACEN' && destino !== 'PEP') return res.status(400).json({ success: false, message: 'Destino debe ser ALMACEN o PEP' });
    if (destino === 'PEP' && !destinoRef) return res.status(400).json({ success: false, message: 'Debe seleccionar un PEP de destino' });
    if (destino === 'PEP' && !(await ensurePepAdjudicado(destinoRef))) {
      return res.status(400).json({ success: false, message: 'El PEP de destino no existe o no está adjudicado' });
    }

    const item = await InventoryItemModel.findOne({ _id: itemId, deleted: false });
    if (!item) return res.status(404).json({ success: false, message: 'Item no encontrado en catálogo' });

    let stock = await InventoryStockModel.findOne({ itemId });
    if (!stock) stock = new InventoryStockModel({ itemId });

    stock.cantidad += cantidad;
    stock.montoTotalIngreso += monto;
    stock.costoUnitarioActual = costoUnitarioActual > 0 ? costoUnitarioActual : stock.costoUnitarioActual;
    stock.ultimoIngresoAt = new Date();
    if (comentarios) stock.ultimoComentario = comentarios;
    await stock.save();

    await InventoryMovementModel.create({
      tipo: 'INGRESO', itemId, cantidad,
      costoUnitario: costoUnitarioActual, monto,
      destino, destinoRef, comentarios,
      categoria: item.categoria, usuario,
    });

    return res.status(201).json({ success: true, message: 'Ingreso registrado correctamente', data: stock });
  } catch (error) {
    console.error('[almacen:registerIngreso]', error.message);
    return res.status(500).json({ success: false, message: 'Error al registrar ingreso' });
  }
};

const registerSalida = async (req, res) => {
  try {
    const itemId = String(req.body.itemId || '').trim();
    const cantidad = toNumber(req.body.cantidad);
    const destino = String(req.body.destino || 'ALMACEN').trim().toUpperCase();
    const destinoRef = String(req.body.destinoRef || (destino === 'ALMACEN' ? 'ALMACEN' : '')).trim();
    const comentarios = String(req.body.comentarios || '').trim();
    const usuario = getEmail(req);

    if (!itemId || cantidad <= 0) return res.status(400).json({ success: false, message: 'Item y cantidad > 0 requeridos' });
    if (destino !== 'ALMACEN' && destino !== 'PEP') return res.status(400).json({ success: false, message: 'Destino debe ser ALMACEN o PEP' });
    if (destino === 'PEP' && !destinoRef) return res.status(400).json({ success: false, message: 'Debe seleccionar PEP de destino' });
    if (destino === 'PEP' && !(await ensurePepAdjudicado(destinoRef))) {
      return res.status(400).json({ success: false, message: 'El PEP de destino no existe o no está adjudicado' });
    }

    const stock = await InventoryStockModel.findOne({ itemId });
    if (!stock || stock.cantidad < cantidad) return res.status(400).json({ success: false, message: 'Stock insuficiente' });

    const item = await InventoryItemModel.findOne({ _id: itemId, deleted: false });
    if (!item) return res.status(404).json({ success: false, message: 'Item no encontrado' });

    const costoUnitario = stock.costoUnitarioActual;
    const monto = costoUnitario * cantidad;

    stock.cantidad -= cantidad;
    await stock.save();

    await InventoryMovementModel.create({
      tipo: 'SALIDA', itemId, cantidad, costoUnitario, monto,
      destino, destinoRef, comentarios,
      categoria: item.categoria, usuario,
    });

    return res.status(201).json({ success: true, message: 'Salida registrada correctamente', data: stock });
  } catch (error) {
    console.error('[almacen:registerSalida]', error.message);
    return res.status(500).json({ success: false, message: 'Error al registrar salida' });
  }
};

const registerMultipleSalidas = async (req, res) => {
  try {
    const items = req.body.items || [];
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, message: 'Debe enviar al menos un item' });

    const usuario = getEmail(req);
    const resultados = [];
    const errores = [];

    for (const entry of items) {
      const itemId = String(entry.itemId || '').trim();
      const cantidad = toNumber(entry.cantidad);
      const destino = String(entry.destino || 'ALMACEN').trim().toUpperCase();
      const destinoRef = String(entry.destinoRef || (destino === 'ALMACEN' ? 'ALMACEN' : '')).trim();
      const comentarios = String(entry.comentarios || '').trim();

      if (!itemId || cantidad <= 0) { errores.push({ itemId: itemId || '?', error: 'Item y cantidad > 0 requeridos' }); continue; }
      if (destino !== 'ALMACEN' && destino !== 'PEP') { errores.push({ itemId, error: 'Destino inválido' }); continue; }
      if (destino === 'PEP' && !destinoRef) { errores.push({ itemId, error: 'PEP requerido' }); continue; }
      if (destino === 'PEP' && !(await ensurePepAdjudicado(destinoRef))) {
        errores.push({ itemId, error: 'El PEP de destino no existe o no está adjudicado' });
        continue;
      }

      const stock = await InventoryStockModel.findOne({ itemId });
      if (!stock || stock.cantidad < cantidad) { errores.push({ itemId, error: `Stock insuficiente (disp: ${stock?.cantidad || 0})` }); continue; }

      const item = await InventoryItemModel.findOne({ _id: itemId, deleted: false });
      if (!item) { errores.push({ itemId, error: 'Item no encontrado' }); continue; }

      const costoUnitario = stock.costoUnitarioActual;
      const monto = costoUnitario * cantidad;
      stock.cantidad -= cantidad;
      await stock.save();

      await InventoryMovementModel.create({
        tipo: 'SALIDA', itemId, cantidad, costoUnitario, monto,
        destino, destinoRef, comentarios, categoria: item.categoria, usuario,
      });

      resultados.push({ itemId, nombre: item.nombre, cantidad });
    }

    return res.status(200).json({
      success: true,
      message: `${resultados.length} salida(s) registrada(s)${errores.length > 0 ? `, ${errores.length} error(es)` : ''}`,
      data: { resultados, errores },
    });
  } catch (error) {
    console.error('[almacen:registerMultipleSalidas]', error.message);
    return res.status(500).json({ success: false, message: 'Error al registrar salidas masivas' });
  }
};

// ─── Kardex ──────────────────────────────────────────────────────────────────

const getKardex = async (req, res) => {
  try {
    const page = Math.max(toNumber(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(toNumber(req.query.pageSize) || 20, 1), 100);
    const itemId = String(req.query.itemId || '').trim();
    const fechaDesde = req.query.fechaDesde ? new Date(req.query.fechaDesde) : null;
    const fechaHasta = req.query.fechaHasta ? new Date(req.query.fechaHasta + 'T23:59:59.999Z') : null;

    const filter = {};
    if (itemId) filter.itemId = itemId;
    if (fechaDesde && !isNaN(fechaDesde.getTime())) filter.createdAt = { $gte: fechaDesde };
    if (fechaHasta && !isNaN(fechaHasta.getTime())) filter.createdAt = { ...filter.createdAt, $lte: fechaHasta };

    const total = await InventoryMovementModel.countDocuments(filter);
    const rows = await InventoryMovementModel.find(filter)
      .populate('itemId', 'nombre codigo categoria tipo')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    return res.status(200).json({ success: true, data: { rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } });
  } catch (error) {
    console.error('[almacen:getKardex]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener kardex' });
  }
};

const getKardexByItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const page = Math.max(toNumber(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(toNumber(req.query.pageSize) || 20, 1), 100);

    const filter = { itemId };
    const total = await InventoryMovementModel.countDocuments(filter);
    const rows = await InventoryMovementModel.find(filter)
      .populate('itemId', 'nombre codigo categoria tipo')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    return res.status(200).json({ success: true, data: { rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } });
  } catch (error) {
    console.error('[almacen:getKardexByItem]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener kardex del item' });
  }
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const [stockRows, itemsBajoSeguridad, calibraciones, stockConItems] = await Promise.all([
      InventoryStockModel.find().populate('itemId', 'nombre categoria tipo').lean(),
      InventoryStockModel.aggregate([
        { $lookup: { from: 'InventoryItem', localField: 'itemId', foreignField: '_id', as: '_item' } },
        { $unwind: '$_item' },
        { $match: { '_item.deleted': false } },
        { $addFields: { diff: { $subtract: ['$cantidad', '$_item.stockSeguridad'] } } },
        { $match: { diff: { $lt: 0 } } },
        { $project: { _id: 0, itemId: 1, cantidad: 1, stockSeguridad: '$_item.stockSeguridad', nombre: '$_item.nombre' } },
      ]),
      InventoryItemModel.find({ deleted: false, fechaCalibracion: { $ne: null }, duracionCalibracionMeses: { $gt: 0 } })
        .select('nombre categoria fechaCalibracion duracionCalibracionMeses')
        .lean(),
      InventoryStockModel.aggregate([
        { $lookup: { from: 'InventoryItem', localField: 'itemId', foreignField: '_id', as: '_item' } },
        { $unwind: '$_item' },
        { $match: { '_item.deleted': false } },
        { $project: { cantidad: 1, categoria: '$_item.categoria', _id: 0 } },
      ]),
    ]);

    const totalValorStock = stockRows.reduce((s, r) => s + (r.montoTotalIngreso || 0), 0);
    const totalItems = stockRows.length;

    // Calcular valor stock base desde InventoryCategory
    const catNames = [...new Set(stockConItems.map((r) => r.categoria).filter(Boolean))];
    const cats = await InventoryCategoryModel.find({ nombre: { $in: catNames }, deleted: false })
      .select('nombre costoUnitario')
      .lean();
    const catCostoMap = new Map(cats.map((c) => [c.nombre, c.costoUnitario || 0]));
    const totalValorStockBase = stockConItems.reduce((s, r) => {
      const costoBase = catCostoMap.get(r.categoria) || 0;
      return s + (r.cantidad || 0) * costoBase;
    }, 0);

    const ahora = new Date();
    const proximasCalibraciones = calibraciones
      .map((item) => {
        const fechaVenc = new Date(item.fechaCalibracion);
        fechaVenc.setMonth(fechaVenc.getMonth() + (item.duracionCalibracionMeses || 0));
        const diasRestantes = Math.ceil((fechaVenc.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24));
        return { itemId: item._id, nombre: item.nombre, categoria: item.categoria, fechaCalibracion: item.fechaCalibracion, fechaVencimiento: fechaVenc, diasRestantes };
      })
      .filter((c) => c.diasRestantes <= 30)
      .sort((a, b) => a.diasRestantes - b.diasRestantes);

    return res.status(200).json({
      success: true,
      data: { totalItems, totalValorStock, totalValorStockBase, itemsBajoSeguridad: itemsBajoSeguridad.length, proximasCalibraciones },
    });
  } catch (error) {
    console.error('[almacen:getDashboard]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener dashboard' });
  }
};

module.exports = {
  listCategories, createCategory,
  listItems, createItem, updateItem,
  getStock,
  registerIngreso, registerSalida, registerMultipleSalidas,
  getKardex, getKardexByItem,
  getDashboard,
};
