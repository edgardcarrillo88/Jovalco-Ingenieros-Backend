/**
 * Migración del módulo Almacén (2026-09).
 *
 * Objetivo: dejar el inventario consistente con la regla
 * "un código de material = un nombre + una categoría + un tipo".
 *
 * Pasos:
 *  1. Fusiona los items duplicados (mismo nombre + categoría + tipo) en el más
 *     antiguo: reasigna sus movimientos, suma su stock y desactiva el duplicado.
 *  2. Asigna un código de material (MAT-XXXX) a los items que no lo tienen.
 *  3. Revalúa cada material: aplica el último costo de ingreso a todo su stock.
 *
 * Es idempotente: si se vuelve a ejecutar no encuentra duplicados ni items sin
 * código, y la revaluación deja el mismo resultado.
 *
 * Uso: node scripts/migrate-almacen-materiales.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const ItemModel = require('../models/almacen/item');
const StockModel = require('../models/almacen/stock');
const MovementModel = require('../models/almacen/movement');
const ItemCounterModel = require('../models/almacen/item_counter');

const DRY_RUN = process.argv.includes('--dry-run');

const normalize = (value) => String(value || '').trim().toLowerCase();

const claveMaterial = (item) =>
  `${normalize(item.nombre)}|${normalize(item.categoria)}|${normalize(item.tipo)}`;

const generarCodigo = async () => {
  const counter = await ItemCounterModel.findOneAndUpdate(
    { name: 'ITEM' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return `MAT-${String(counter.seq).padStart(4, '0')}`;
};

const run = async () => {
  await mongoose.connect(`mongodb+srv://eacarrilloiparraguirre_db_user:${process.env.MONGO_DB_PASS}@clusterjovalco.bzehbnn.mongodb.net/Project?retryWrites=true&w=majority`);

  console.log(DRY_RUN ? '=== MODO DRY-RUN (no se escriben cambios) ===' : '=== APLICANDO MIGRACIÓN ===');

  // ── Respaldo previo ────────────────────────────────────────────────────────
  const backup = {
    items: await ItemModel.find({}).lean(),
    stocks: await StockModel.find({}).lean(),
    movements: await MovementModel.find({}).lean(),
    counter: await ItemCounterModel.find({}).lean(),
    fecha: new Date().toISOString(),
  };

  if (!DRY_RUN) {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `almacen-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`Respaldo guardado en: ${backupPath}`);
  }
  console.log(`Documentos actuales -> items: ${backup.items.length}, stocks: ${backup.stocks.length}, movimientos: ${backup.movements.length}\n`);

  // ── Paso 1: fusionar duplicados ────────────────────────────────────────────
  const activos = await ItemModel.find({ deleted: false }).sort({ createdAt: 1 }).lean();
  const grupos = new Map();
  activos.forEach((item) => {
    const key = claveMaterial(item);
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(item);
  });

  console.log('── Paso 1: fusionar duplicados ──');
  let fusiones = 0;

  for (const [key, items] of grupos.entries()) {
    if (items.length < 2) continue;

    const [superviviente, ...duplicados] = items; // el más antiguo sobrevive
    console.log(`\n[${key}]`);
    console.log(`  Sobrevive: ${superviviente._id} (${superviviente.createdAt.toISOString?.() || superviviente.createdAt})`);

    let stockSuperviviente = await StockModel.findOne({ itemId: superviviente._id }).lean();
    let cantidadTotal = stockSuperviviente?.cantidad || 0;
    let montoTotal = stockSuperviviente?.montoTotalIngreso || 0;

    for (const dup of duplicados) {
      const movs = await MovementModel.countDocuments({ itemId: dup._id });
      const stockDup = await StockModel.findOne({ itemId: dup._id }).lean();
      cantidadTotal += stockDup?.cantidad || 0;
      montoTotal += stockDup?.montoTotalIngreso || 0;

      console.log(`  Fusiona: ${dup._id} -> ${movs} movimientos, stock ${stockDup?.cantidad || 0}`);

      if (!DRY_RUN) {
        await MovementModel.updateMany({ itemId: dup._id }, { $set: { itemId: superviviente._id } });
        await StockModel.deleteMany({ itemId: dup._id });
        await ItemModel.updateOne({ _id: dup._id }, { $set: { deleted: true, fusionadoEn: superviviente._id } });
      }
      fusiones += 1;
    }

    console.log(`  Stock resultante: ${cantidadTotal} | Monto acumulado: ${montoTotal}`);

    if (!DRY_RUN) {
      await StockModel.updateOne(
        { itemId: superviviente._id },
        { $set: { cantidad: cantidadTotal, montoTotalIngreso: montoTotal } },
        { upsert: true },
      );
    }
  }

  if (fusiones === 0) console.log('  (sin duplicados)');

  // ── Paso 2: asignar códigos ───────────────────────────────────────────────
  console.log('\n── Paso 2: asignar códigos de material ──');
  const sinCodigo = await ItemModel.find({ deleted: false, $or: [{ codigo: '' }, { codigo: null }, { codigo: { $exists: false } }] }).sort({ createdAt: 1 }).lean();

  if (sinCodigo.length === 0) console.log('  (todos los items ya tienen código)');

  const codigosAsignados = [];
  for (const item of sinCodigo) {
    const codigo = DRY_RUN ? 'MAT-????' : await generarCodigo();
    console.log(`  ${item.nombre} (${item.categoria}) -> ${codigo}`);
    codigosAsignados.push({ id: String(item._id), codigo });
    if (!DRY_RUN) {
      await ItemModel.updateOne({ _id: item._id }, { $set: { codigo } });
    }
  }

  // ── Paso 3: revaluar materiales con el último costo de ingreso ────────────
  console.log('\n── Paso 3: revaluar materiales (último costo de ingreso) ──');
  const activosFinales = await ItemModel.find({ deleted: false }).lean();
  const porCodigo = new Map();
  activosFinales.forEach((item) => {
    const codigo = String(item.codigo || '').trim();
    if (!codigo) return;
    if (!porCodigo.has(codigo)) porCodigo.set(codigo, []);
    porCodigo.get(codigo).push(item);
  });

  let revaluados = 0;
  for (const [codigo, items] of porCodigo.entries()) {
    const ids = items.map((i) => i._id);
    const ultimoIngreso = await MovementModel.findOne({ itemId: { $in: ids }, tipo: 'INGRESO' })
      .sort({ createdAt: -1 })
      .lean();

    if (!ultimoIngreso || !(ultimoIngreso.costoUnitario > 0)) {
      console.log(`  ${codigo}: sin ingreso registrado, se omite`);
      continue;
    }

    const stocks = await StockModel.find({ itemId: { $in: ids } }).lean();
    const cantidadTotal = stocks.reduce((acc, s) => acc + (s.cantidad || 0), 0);

    console.log(`  ${codigo} (${items[0].nombre}): costo ${ultimoIngreso.costoUnitario} x ${cantidadTotal} uds = S/ ${(cantidadTotal * ultimoIngreso.costoUnitario).toFixed(2)}`);

    if (!DRY_RUN) {
      await ItemModel.updateMany({ _id: { $in: ids } }, { $set: { costoUnitario: ultimoIngreso.costoUnitario } });
      await StockModel.updateMany({ itemId: { $in: ids } }, { $set: { costoUnitarioActual: ultimoIngreso.costoUnitario } });
    }
    revaluados += 1;
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('\n=== RESUMEN ===');
  console.log(`Duplicados fusionados: ${fusiones}`);
  console.log(`Códigos asignados: ${codigosAsignados.length}`);
  console.log(`Materiales revaluados: ${revaluados}`);

  if (!DRY_RUN) {
    const finalItems = await ItemModel.find({ deleted: false }).lean();
    const finalStocks = await StockModel.find().lean();
    const stockMap = new Map(finalStocks.map((s) => [String(s.itemId), s]));
    console.log('\n=== ESTADO FINAL ===');
    console.table(finalItems.map((i) => ({
      codigo: i.codigo,
      nombre: i.nombre,
      categoria: i.categoria,
      tipo: i.tipo,
      costoBase: i.costoUnitario,
      stock: stockMap.get(String(i._id))?.cantidad ?? null,
    })));
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
