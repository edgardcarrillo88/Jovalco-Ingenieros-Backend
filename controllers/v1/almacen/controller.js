const InventoryItemModel = require('../../../models/almacen/item');
const InventoryStockModel = require('../../../models/almacen/stock');
const InventoryMovementModel = require('../../../models/almacen/movement');
const InventoryCategoryModel = require('../../../models/almacen/category');
const InventoryBatchModel = require('../../../models/almacen/batch');
const almacenService = require('../../../services/v1/almacen/service');
const { ServiceError } = require('../../../services/v1/almacen/errors');
const mongoose = require('mongoose');

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(n, 0) : 0;
};

/**
 * Traduce los errores de negocio del service a respuestas HTTP.
 * Los errores inesperados se registran y responden 500.
 */
const handleServiceError = (res, error, fallbackMessage) => {
  if (error instanceof ServiceError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  console.error(fallbackMessage, error.message);
  return res.status(500).json({ success: false, message: fallbackMessage });
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

// ─── Categorías ──────────────────────────────────────────────────────────────

const listCategories = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = { deleted: false };
    if (q) filter.nombre = { $regex: almacenService.escapeRegExp(q), $options: 'i' };

    const rows = await InventoryCategoryModel.find(filter)
      .select('nombre personalizada')
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

    const exists = await InventoryCategoryModel.findOne({ nombre, deleted: false }).lean();
    if (exists) return res.status(400).json({ success: false, message: 'La categoría ya existe' });

    const category = await InventoryCategoryModel.create({ nombre, personalizada: true });
    return res.status(201).json({ success: true, data: category });
  } catch (error) {
    console.error('[almacen:createCategory]', error.message);
    return res.status(500).json({ success: false, message: 'Error al crear categoría' });
  }
};

// ─── Items ───────────────────────────────────────────────────────────────────

/**
 * Lista items filtrando por categoría, código, nombre y tipo.
 * Los filtros se construyen a partir de criterios permitidos (nunca se
 * construyen consultas directamente desde la entrada del cliente).
 */
const listItems = async (req, res) => {
  try {
    const rows = await almacenService.searchItems({
      categoria: req.query.categoria,
      codigo: req.query.codigo,
      nombre: req.query.nombre,
      tipo: req.query.tipo,
      search: req.query.search,
    });

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

    const categoria = String(req.body.categoria || '').trim();
    if (!categoria) return res.status(400).json({ success: false, message: 'Categoría requerida' });

    const tipo = String(req.body.tipo || 'Componente').trim();

    // Si el material ya existe (mismo nombre + categoría + tipo), se reutiliza
    // en lugar de crear un duplicado. El stock se acumula en el mismo código.
    const existente = await almacenService.findMaterialRegistrado({ nombre, categoria, tipo });
    if (existente) {
      await almacenService.ensureStockInitial(existente._id);
      return res.status(200).json({ success: true, data: existente, reutilizado: true });
    }

    // El código es autogenerado cuando el usuario no informa uno.
    const codigo = await almacenService.resolveItemCodigo(req.body.codigo);
    await almacenService.ensureItemNoDuplicado({ codigo });

    const catExists = await InventoryCategoryModel.findOne({ nombre: categoria, deleted: false }).lean();
    if (!catExists) {
      await InventoryCategoryModel.create({ nombre: categoria, personalizada: true });
    }

    const item = await InventoryItemModel.create({
      codigo,
      nombre,
      categoria,
      tipo,
      costoUnitario: toNumber(req.body.costoUnitario),
      stockSeguridad: toNumber(req.body.stockSeguridad),
      fechaCalibracion: req.body.fechaCalibracion || null,
      duracionCalibracionMeses: toNumber(req.body.duracionCalibracionMeses),
    });

    await InventoryStockModel.create({ itemId: item._id });
    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    return handleServiceError(res, error, 'Error al crear item');
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

    // Se valida duplicado solo si el código cambia.
    await almacenService.ensureItemNoDuplicado({
      codigo: update.codigo !== undefined ? String(update.codigo).trim() : undefined,
      excludeId: id,
    });

    const item = await InventoryItemModel.findOneAndUpdate(
      { _id: id, deleted: false },
      { $set: update },
      { new: true },
    );
    if (!item) return res.status(404).json({ success: false, message: 'Item no encontrado' });

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return handleServiceError(res, error, 'Error al actualizar item');
  }
};

// ─── Stock ───────────────────────────────────────────────────────────────────

/**
 * Stock explotado por LOTE: una fila por cada ingreso realizado.
 *
 * Cada fila conserva el costo unitario con el que ingresó y las unidades que
 * le quedan disponibles, para poder diferenciar por costo de ingreso.
 * Se agrupa visualmente por categoría y se puede filtrar por categoría,
 * código, nombre y tipo.
 */
const getStock = async (req, res) => {
  try {
    const categoria = String(req.query.categoria || '').trim();
    const codigo = String(req.query.codigo || '').trim();
    const nombre = String(req.query.nombre || '').trim();
    const tipo = String(req.query.tipo || '').trim();
    const page = Math.max(toNumber(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(toNumber(req.query.pageSize) || 100, 1), 500);

    const pipeline = [
      { $lookup: { from: 'InventoryItem', localField: 'itemId', foreignField: '_id', as: '_item' } },
      { $unwind: { path: '$_item', preserveNullAndEmptyArrays: false } },
      { $match: { '_item.deleted': false } },
      { $addFields: {
        itemNombre: '$_item.nombre',
        itemCodigo: { $ifNull: ['$codigo', ''] },
        itemCategoria: '$_item.categoria',
        itemTipo: '$_item.tipo',
        itemCostoUnitario: '$_item.costoUnitario',
        itemStockSeguridad: '$_item.stockSeguridad',
        itemFechaCalibracion: '$_item.fechaCalibracion',
        itemDuracionCalibracionMeses: '$_item.duracionCalibracionMeses',
        totalLote: {
          $multiply: [
            { $ifNull: ['$cantidadDisponible', 0] },
            { $ifNull: ['$costoUnitario', 0] },
          ],
        },
      }},
    ];

    // Filtros permitidos: categoría, código, nombre y tipo.
    // Se aplican sobre los campos ya proyectados del item (después del $unwind).
    const filtrosItem = {};
    if (categoria) filtrosItem.itemCategoria = categoria;
    if (tipo) filtrosItem.itemTipo = tipo;
    if (codigo) filtrosItem.itemCodigo = { $regex: almacenService.escapeRegExp(codigo), $options: 'i' };
    if (nombre) filtrosItem.itemNombre = { $regex: almacenService.escapeRegExp(nombre), $options: 'i' };

    if (Object.keys(filtrosItem).length > 0) {
      pipeline.push({ $match: filtrosItem });
    }

    pipeline.push({ $sort: { itemCategoria: 1, itemNombre: 1, fechaIngreso: -1 } });

    const countResult = await InventoryBatchModel.aggregate([...pipeline, { $count: 'total' }]);
    const total = countResult[0]?.total || 0;
    const skip = (page - 1) * pageSize;

    const rows = await InventoryBatchModel.aggregate([...pipeline, { $skip: skip }, { $limit: pageSize }]);

    const grouped = rows.reduce((acc, row) => {
      const cat = row.itemCategoria || 'Sin categoría';
      if (!acc[cat]) acc[cat] = { categoria: cat, items: [], subtotal: 0, totalBase: 0 };

      const cantidadDisponible = row.cantidadDisponible || 0;
      const costoIngreso = row.costoUnitario || 0;
      const totalLote = row.totalLote || 0;

      acc[cat].items.push({
        _id: row._id,
        batchId: row._id,
        itemId: row.itemId,
        codigo: row.itemCodigo,
        nombre: row.itemNombre,
        tipo: row.itemTipo,
        // Cantidad remanente del lote y cantidad originalmente ingresada.
        cantidad: cantidadDisponible,
        cantidadIngresada: row.cantidad || 0,
        // Costo unitario con el que ingresó este lote.
        costoUnitarioConfig: row.itemCostoUnitario || 0,
        costoUnitarioActual: costoIngreso,
        montoTotalIngreso: row.monto || 0,
        totalUnitarioBase: totalLote,
        fechaIngreso: row.fechaIngreso,
        stockSeguridad: row.itemStockSeguridad || 0,
        ultimoComentario: row.comentarios || '',
        fechaCalibracion: row.itemFechaCalibracion,
        duracionCalibracionMeses: row.itemDuracionCalibracionMeses,
      });

      // Subtotal de la categoría: valor del stock remanente a su costo de ingreso.
      acc[cat].subtotal += totalLote;
      acc[cat].totalBase += totalLote;
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

/**
 * Lista los lotes (ingresos) de un material, con su costo y saldo disponible.
 * Se usa en el formulario de salidas para elegir de qué lote se retira.
 */
const getLotes = async (req, res) => {
  try {
    const itemId = String(req.query.itemId || '').trim();
    if (!itemId) return res.status(400).json({ success: false, message: 'itemId requerido' });

    const soloDisponibles = String(req.query.soloDisponibles || '') === 'true';
    const rows = await almacenService.listLotesMaterial({ itemId, soloDisponibles });

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[almacen:getLotes]', error.message);
    return res.status(500).json({ success: false, message: 'Error al obtener lotes' });
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
    const elementoPEP = destino === 'PEP' ? String(req.body.elementoPEP || '').trim() : '';
    const comentarios = String(req.body.comentarios || '').trim();
    const usuario = getEmail(req);

    if (!itemId || cantidad <= 0) return res.status(400).json({ success: false, message: 'Item y cantidad > 0 requeridos' });
    if (destino !== 'ALMACEN' && destino !== 'PEP') return res.status(400).json({ success: false, message: 'Destino debe ser ALMACEN o PEP' });

    // El destino PEP exige PEP adjudicado y elemento PEP habilitado (regla compartida con Logística).
    await almacenService.validateDestinoPep({ destino, destinoRef, elementoPEP });

    const item = await InventoryItemModel.findOne({ _id: itemId, deleted: false });
    if (!item) return res.status(404).json({ success: false, message: 'Item no encontrado en catálogo' });

    let stock = await InventoryStockModel.findOne({ itemId });
    if (!stock) stock = new InventoryStockModel({ itemId });

    stock.cantidad += cantidad;
    stock.montoTotalIngreso += monto;
    // El costo vigente del stock refleja el último ingreso, pero cada lote
    // conserva su propio costo (no se revalúa el stock ya existente).
    stock.costoUnitarioActual = costoUnitarioActual > 0 ? costoUnitarioActual : stock.costoUnitarioActual;
    stock.ultimoIngresoAt = new Date();
    if (comentarios) stock.ultimoComentario = comentarios;
    await stock.save();

    // El costo unitario base del material se actualiza con el último ingreso.
    await almacenService.syncCostoUnitarioBase(itemId, costoUnitarioActual);

    const movimiento = await InventoryMovementModel.create({
      tipo: 'INGRESO', itemId, cantidad,
      costoUnitario: costoUnitarioActual, monto,
      destino, destinoRef, elementoPEP, comentarios,
      categoria: item.categoria, usuario,
    });

    // Cada ingreso genera su propio lote, con su costo y cantidad disponible.
    const lote = await almacenService.crearLoteIngreso({
      itemId,
      movementId: movimiento._id,
      codigo: item.codigo,
      cantidad,
      costoUnitario: costoUnitarioActual,
      monto,
      comentarios,
      usuario,
      fechaIngreso: movimiento.createdAt || new Date(),
    });

    return res.status(201).json({
      success: true,
      message: 'Ingreso registrado correctamente',
      data: { ...stock.toObject(), lote },
    });
  } catch (error) {
    return handleServiceError(res, error, 'Error al registrar ingreso');
  }
};

const registerSalida = async (req, res) => {
  try {
    const itemId = String(req.body.itemId || '').trim();
    const batchId = String(req.body.batchId || '').trim();
    const cantidad = toNumber(req.body.cantidad);
    const destino = String(req.body.destino || 'ALMACEN').trim().toUpperCase();
    const destinoRef = String(req.body.destinoRef || (destino === 'ALMACEN' ? 'ALMACEN' : '')).trim();
    const elementoPEP = destino === 'PEP' ? String(req.body.elementoPEP || '').trim() : '';
    const comentarios = String(req.body.comentarios || '').trim();
    const usuario = getEmail(req);

    if (!itemId || cantidad <= 0) return res.status(400).json({ success: false, message: 'Item y cantidad > 0 requeridos' });
    if (!batchId) return res.status(400).json({ success: false, message: 'Debe seleccionar el lote (ingreso) a retirar' });
    if (destino !== 'ALMACEN' && destino !== 'PEP') return res.status(400).json({ success: false, message: 'Destino debe ser ALMACEN o PEP' });

    await almacenService.validateDestinoPep({ destino, destinoRef, elementoPEP });

    const item = await InventoryItemModel.findOne({ _id: itemId, deleted: false });
    if (!item) return res.status(404).json({ success: false, message: 'Item no encontrado' });

    // La salida se imputa al lote elegido y usa SU costo unitario de ingreso.
    const { costoUnitario } = await almacenService.consumirLote({ batchId, cantidad });
    const monto = costoUnitario * cantidad;

    const stock = await InventoryStockModel.findOne({ itemId });
    if (!stock || stock.cantidad < cantidad) {
      // Se restituye el lote para no dejar el descuento aplicado.
      await InventoryBatchModel.updateOne({ _id: batchId }, { $inc: { cantidadDisponible: cantidad } });
      return res.status(400).json({ success: false, message: 'Stock insuficiente' });
    }

    stock.cantidad -= cantidad;
    await stock.save();

    await InventoryMovementModel.create({
      tipo: 'SALIDA', itemId, batchId, cantidad, costoUnitario, monto,
      destino, destinoRef, elementoPEP, comentarios,
      categoria: item.categoria, usuario,
    });

    return res.status(201).json({ success: true, message: 'Salida registrada correctamente', data: stock });
  } catch (error) {
    return handleServiceError(res, error, 'Error al registrar salida');
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
      const batchId = String(entry.batchId || '').trim();
      const cantidad = toNumber(entry.cantidad);
      const destino = String(entry.destino || 'ALMACEN').trim().toUpperCase();
      const destinoRef = String(entry.destinoRef || (destino === 'ALMACEN' ? 'ALMACEN' : '')).trim();
      const elementoPEP = destino === 'PEP' ? String(entry.elementoPEP || '').trim() : '';
      const comentarios = String(entry.comentarios || '').trim();

      if (!itemId || cantidad <= 0) { errores.push({ itemId: itemId || '?', error: 'Item y cantidad > 0 requeridos' }); continue; }
      if (!batchId) { errores.push({ itemId, error: 'Debe seleccionar el lote (ingreso) a retirar' }); continue; }
      if (destino !== 'ALMACEN' && destino !== 'PEP') { errores.push({ itemId, error: 'Destino inválido' }); continue; }

      try {
        await almacenService.validateDestinoPep({ destino, destinoRef, elementoPEP });
      } catch (error) {
        errores.push({ itemId, error: error.message });
        continue;
      }

      const item = await InventoryItemModel.findOne({ _id: itemId, deleted: false });
      if (!item) { errores.push({ itemId, error: 'Item no encontrado' }); continue; }

      // La salida se imputa al lote elegido y usa SU costo unitario de ingreso.
      let costoUnitario;
      try {
        ({ costoUnitario } = await almacenService.consumirLote({ batchId, cantidad }));
      } catch (error) {
        errores.push({ itemId, error: error.message });
        continue;
      }

      const stock = await InventoryStockModel.findOne({ itemId });
      if (!stock || stock.cantidad < cantidad) {
        await InventoryBatchModel.updateOne({ _id: batchId }, { $inc: { cantidadDisponible: cantidad } });
        errores.push({ itemId, error: `Stock insuficiente (disp: ${stock?.cantidad || 0})` });
        continue;
      }

      const monto = costoUnitario * cantidad;
      stock.cantidad -= cantidad;
      await stock.save();

      await InventoryMovementModel.create({
        tipo: 'SALIDA', itemId, batchId, cantidad, costoUnitario, monto,
        destino, destinoRef, elementoPEP, comentarios, categoria: item.categoria, usuario,
      });

      resultados.push({ itemId, nombre: item.nombre, cantidad, costoUnitario });
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
    const [items, itemsBajoSeguridad, calibraciones, lotes] = await Promise.all([
      InventoryItemModel.find({ deleted: false }).select('codigo nombre').lean(),
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
      // Los lotes son la fuente del stock: cada fila tiene su costo y saldo.
      InventoryBatchModel.find().select('cantidadDisponible costoUnitario').lean(),
    ]);

    // El valor del stock se calcula con el costo y el saldo de cada lote.
    const totalValorStock = lotes.reduce(
      (s, l) => s + (l.cantidadDisponible || 0) * (l.costoUnitario || 0),
      0,
    );
    const totalValorStockBase = totalValorStock;
    const totalItems = items.length;

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
  getStock, getLotes,
  registerIngreso, registerSalida, registerMultipleSalidas,
  getKardex, getKardexByItem,
  getDashboard,
};
