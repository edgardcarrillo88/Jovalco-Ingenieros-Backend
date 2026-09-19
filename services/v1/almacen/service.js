/**
 * Lógica de negocio del módulo Almacén.
 *
 * Contiene únicamente las reglas nuevas/ajustadas del módulo:
 *   - Generación automática del código de material.
 *   - Búsqueda de items por categoría, código, nombre y tipo.
 *   - Actualización del costo unitario base del item con el último costo de ingreso.
 *   - Validación del elemento PEP de destino (regla compartida con Comercial/Logística).
 *
 * No depende de Express: recibe y retorna datos planos, y lanza ServiceError
 * para que el controller traduzca el error a una respuesta HTTP.
 */
const InventoryItemModel = require('../../../models/almacen/item');
const InventoryStockModel = require('../../../models/almacen/stock');
const InventoryBatchModel = require('../../../models/almacen/batch');
const InventoryItemCounterModel = require('../../../models/almacen/item_counter');
const pepService = require('../comercial/pepService');
const { ServiceError, badRequest } = require('./errors');

// Escapa caracteres especiales de regex para evitar que el cliente construya
// expresiones arbitrarias a partir de los filtros de búsqueda.
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Clave de agrupación de un material.
 * El código es la identidad; los items antiguos sin código se agrupan por
 * nombre normalizado para no perder información mientras se migran.
 */
const itemCodigoKey = (item) => {
  const codigo = String(item.codigo || '').trim();
  if (codigo) return codigo.toUpperCase();
  return `SIN-CODIGO:${String(item.nombre || '').trim().toLowerCase()}`;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(n, 0) : 0;
};

/**
 * Genera el siguiente código de material con formato MAT-0001.
 * El contador se incrementa de forma atómica para evitar duplicados.
 */
const generateCodigoMaterial = async () => {
  const counter = await InventoryItemCounterModel.findOneAndUpdate(
    { name: 'ITEM' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (!counter) {
    throw new ServiceError('No fue posible generar el código de material', 500);
  }

  return `MAT-${String(counter.seq).padStart(4, '0')}`;
};

/**
 * Verifica que no exista otro item (no eliminado) con el mismo código.
 * Lanza ServiceError 400 con el mensaje esperado por la UI.
 */
const ensureItemNoDuplicado = async ({ codigo, excludeId } = {}) => {
  const codigoLimpio = String(codigo || '').trim();
  if (!codigoLimpio) return;

  const filtro = { deleted: false, codigo: codigoLimpio };
  if (excludeId) filtro._id = { $ne: excludeId };

  const duplicado = await InventoryItemModel.findOne(filtro).select('_id').lean();

  if (duplicado) {
    throw badRequest(`Ya existe un item con el código "${codigoLimpio}"`);
  }
};

/**
 * Busca el material ya registrado que coincide con nombre + categoría + tipo.
 * Un material es único por esa combinación: un código solo puede tener un
 * nombre, una categoría y un tipo.
 */
const findMaterialRegistrado = async ({ nombre, categoria, tipo } = {}) => {
  const nombreLimpio = String(nombre || '').trim();
  const categoriaLimpia = String(categoria || '').trim();
  const tipoLimpio = String(tipo || '').trim();

  if (!nombreLimpio || !categoriaLimpia) return null;

  const filtro = {
    deleted: false,
    nombre: { $regex: `^${escapeRegExp(nombreLimpio)}$`, $options: 'i' },
    categoria: { $regex: `^${escapeRegExp(categoriaLimpia)}$`, $options: 'i' },
  };
  if (tipoLimpio) filtro.tipo = tipoLimpio;

  return InventoryItemModel.findOne(filtro).select('codigo nombre categoria tipo costoUnitario').lean();
};

/**
 * Resuelve el código definitivo de un item:
 * usa el código recibido o genera uno correlativo cuando viene vacío.
 */
const resolveItemCodigo = async (codigoRecibido) => {
  const codigo = String(codigoRecibido || '').trim();
  return codigo || generateCodigoMaterial();
};

/**
 * Construye el filtro de búsqueda de items a partir de los criterios
 * permitidos: categoría, código, nombre y tipo.
 * El parámetro `search` se mantiene por compatibilidad y busca por nombre o código.
 */
const buildItemFilter = ({ categoria, codigo, nombre, tipo, search } = {}) => {
  const filter = { deleted: false };

  const categoriaLimpia = String(categoria || '').trim();
  const tipoLimpio = String(tipo || '').trim();
  const codigoLimpio = String(codigo || '').trim();
  const nombreLimpio = String(nombre || '').trim();
  const searchLimpio = String(search || '').trim();

  if (categoriaLimpia) filter.categoria = categoriaLimpia;
  if (tipoLimpio) filter.tipo = tipoLimpio;

  const or = [];
  if (codigoLimpio) or.push({ codigo: { $regex: escapeRegExp(codigoLimpio), $options: 'i' } });
  if (nombreLimpio) or.push({ nombre: { $regex: escapeRegExp(nombreLimpio), $options: 'i' } });

  if (or.length === 0 && searchLimpio) {
    const patron = { $regex: escapeRegExp(searchLimpio), $options: 'i' };
    or.push({ nombre: patron }, { codigo: patron });
  }

  if (or.length > 0) filter.$or = or;

  return filter;
};

/**
 * Busca materiales por categoría, código, nombre y tipo.
 * Devuelve UNA sola fila por código de material, con el stock total disponible
 * (suma de todos los items que comparten ese código).
 *
 * El código es la identidad del material: un código tiene un único nombre,
 * categoría y tipo. Los items antiguos sin código se agrupan por código
 * sintético (`SIN-CODIGO-<nombre>`), de modo que nunca se pierde información.
 */
const searchItems = async (criterios = {}) => {
  const filter = buildItemFilter(criterios);

  const items = await InventoryItemModel.find(filter)
    .select('codigo nombre categoria tipo costoUnitario stockSeguridad fechaCalibracion duracionCalibracionMeses')
    .sort({ nombre: 1 })
    .limit(500)
    .lean();

  if (items.length === 0) return [];

  const stocks = await InventoryStockModel.find({ itemId: { $in: items.map((i) => i._id) } })
    .select('itemId cantidad costoUnitarioActual')
    .lean();

  const stockMap = new Map(
    stocks.map((s) => [
      String(s.itemId),
      { cantidad: s.cantidad || 0, costoUnitarioActual: s.costoUnitarioActual || 0 },
    ]),
  );

  // Agrupa por código de material (una fila por código).
  const grupos = new Map();

  items.forEach((item) => {
    const stock = stockMap.get(String(item._id)) || { cantidad: 0, costoUnitarioActual: 0 };
    const key = itemCodigoKey(item);

    if (!grupos.has(key)) {
      grupos.set(key, {
        codigo: item.codigo || '',
        nombre: item.nombre,
        categoria: item.categoria,
        tipo: item.tipo,
        costoUnitario: item.costoUnitario || 0,
        cantidadDisponible: 0,
        // Se conserva el item de mayor costo como referencia para el ingreso.
        itemId: item._id,
        costoUnitarioActual: stock.costoUnitarioActual,
      });
    }

    const grupo = grupos.get(key);
    grupo.cantidadDisponible += stock.cantidad;

    if (stock.costoUnitarioActual > grupo.costoUnitarioActual) {
      grupo.costoUnitarioActual = stock.costoUnitarioActual;
      grupo.costoUnitario = item.costoUnitario || 0;
      grupo.itemId = item._id;
    }
  });

  return Array.from(grupos.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
};

/**
 * Actualiza el costo unitario base del item con el último costo de ingreso
 * registrado, para que Stock y el modal de configuración muestren el valor vigente.
 */
const syncCostoUnitarioBase = async (itemId, costoUnitarioIngreso) => {
  const costo = toNumber(costoUnitarioIngreso);
  if (costo <= 0) return;

  await InventoryItemModel.updateOne(
    { _id: itemId, deleted: false },
    { $set: { costoUnitario: costo } },
  );
};

/**
 * Asegura que un item tenga su documento de stock asociado.
 * Se usa al reutilizar un material ya registrado.
 */
const ensureStockInitial = async (itemId) => {
  if (!itemId) return;

  await InventoryStockModel.updateOne(
    { itemId },
    { $setOnInsert: { itemId, cantidad: 0, montoTotalIngreso: 0, costoUnitarioActual: 0 } },
    { upsert: true },
  );
};

/**
 * Registra un lote por cada ingreso y devuelve el lote creado.
 * El lote conserva el costo unitario del ingreso, de modo que el stock pueda
 * mostrarse explotado por costo de ingreso.
 */
const crearLoteIngreso = async ({
  itemId,
  movementId = null,
  codigo = '',
  cantidad,
  costoUnitario,
  monto,
  comentarios = '',
  usuario = 'sistema',
  fechaIngreso = new Date(),
} = {}) => {
  const cantidadLote = toNumber(cantidad);
  if (!itemId || cantidadLote <= 0) return null;

  return InventoryBatchModel.create({
    itemId,
    movementId,
    codigo: String(codigo || '').trim(),
    cantidad: cantidadLote,
    cantidadDisponible: cantidadLote,
    costoUnitario: toNumber(costoUnitario),
    monto: toNumber(monto),
    comentarios: String(comentarios || '').trim(),
    usuario: String(usuario || 'sistema').trim(),
    fechaIngreso,
  });
};

/**
 * Descuenta cantidad de un lote concreto (la salida se imputa al lote elegido).
 * Valida el saldo disponible y lanza ServiceError si no alcanza.
 * Retorna { lote, costoUnitario } del lote consumido.
 */
const consumirLote = async ({ batchId, cantidad } = {}) => {
  const cantidadConsumo = toNumber(cantidad);
  if (!batchId || cantidadConsumo <= 0) {
    throw badRequest('Lote y cantidad > 0 requeridos');
  }

  const lote = await InventoryBatchModel.findOne({ _id: batchId });
  if (!lote) throw badRequest('El lote seleccionado no existe');

  if (lote.cantidadDisponible < cantidadConsumo) {
    throw badRequest(
      `Stock insuficiente en el lote: disponible ${lote.cantidadDisponible}`,
    );
  }

  lote.cantidadDisponible -= cantidadConsumo;
  await lote.save();

  return { lote, costoUnitario: lote.costoUnitario };
};

/**
 * Lista los lotes de un material (todas las filas de su código), ordenados del
 * más reciente al más antiguo, con el saldo disponible de cada uno.
 *
 * `soloDisponibles` permite devolver únicamente los lotes con saldo, que es lo
 * que necesita el formulario de salidas.
 */
const listLotesMaterial = async ({ itemId, soloDisponibles = false } = {}) => {
  if (!itemId) return [];

  const item = await InventoryItemModel.findOne({ _id: itemId, deleted: false })
    .select('codigo nombre categoria tipo')
    .lean();
  if (!item) return [];

  const codigo = String(item.codigo || '').trim();

  // Se toman los lotes del propio item y, si el material tiene código, también
  // los de cualquier item que comparta ese código (filas históricas).
  const filtro = { itemId };
  if (codigo) {
    const hermanos = await InventoryItemModel.find({ deleted: false, codigo })
      .select('_id')
      .lean();
    filtro.itemId = { $in: hermanos.map((h) => h._id) };
  }

  if (soloDisponibles) filtro.cantidadDisponible = { $gt: 0 };

  const lotes = await InventoryBatchModel.find(filtro)
    .sort({ fechaIngreso: -1 })
    .lean();

  return lotes.map((lote) => ({
    batchId: String(lote._id),
    itemId: String(lote.itemId),
    codigo: lote.codigo || codigo,
    nombre: item.nombre,
    categoria: item.categoria,
    tipo: item.tipo,
    cantidad: lote.cantidad || 0,
    cantidadDisponible: lote.cantidadDisponible || 0,
    costoUnitario: lote.costoUnitario || 0,
    monto: lote.monto || 0,
    comentarios: lote.comentarios || '',
    fechaIngreso: lote.fechaIngreso,
  }));
};

/**
 * Valida el destino PEP de un movimiento de stock.
 * Cuando el destino no es PEP no hay nada que validar.
 */
const validateDestinoPep = async ({ destino, destinoRef, elementoPEP } = {}) => {
  if (destino !== 'PEP') return;

  const validacion = await pepService.validateElementoHabilitado({
    pep: destinoRef,
    elementoPEP,
  });

  if (!validacion.ok) {
    throw badRequest(validacion.message);
  }
};

module.exports = {
  generateCodigoMaterial,
  resolveItemCodigo,
  ensureItemNoDuplicado,
  findMaterialRegistrado,
  ensureStockInitial,
  buildItemFilter,
  searchItems,
  syncCostoUnitarioBase,
  crearLoteIngreso,
  consumirLote,
  listLotesMaterial,
  validateDestinoPep,
  escapeRegExp,
  itemCodigoKey,
  toNumber,
};
