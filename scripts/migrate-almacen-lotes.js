/**
 * Migración al modelo de LOTES (2026-09).
 *
 * Contexto: el stock pasó de "un saldo por material" a "una fila por ingreso".
 * Cada INGRESO histórico se convierte en un lote con su costo y su cantidad, y
 * las SALIDAS históricas se descuentan de los lotes en orden FIFO.
 *
 * También revierte la revaluación aplicada anteriormente: restaura el costo
 * unitario de cada item a su valor previo (tomado del respaldo) y deja de
 * tratar `InventoryItem.costoUnitario` como costo de valorización del stock.
 *
 * Es idempotente: si un material ya tiene lotes, se omite.
 *
 * Uso: node scripts/migrate-almacen-lotes.js [--dry-run] [ruta-respaldo]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const ItemModel = require('../models/almacen/item');
const StockModel = require('../models/almacen/stock');
const MovementModel = require('../models/almacen/movement');
const BatchModel = require('../models/almacen/batch');

const DRY_RUN = process.argv.includes('--dry-run');
const backupArg = process.argv.find((a) => a.endsWith('.json'));

const normalizar = (v) => String(v || '').trim();

const run = async () => {
  await mongoose.connect(`mongodb+srv://eacarrilloiparraguirre_db_user:${process.env.MONGO_DB_PASS}@clusterjovalco.bzehbnn.mongodb.net/Project?retryWrites=true&w=majority`);

  console.log(DRY_RUN ? '=== MODO DRY-RUN (no se escriben cambios) ===' : '=== APLICANDO MIGRACIÓN A LOTES ===');

  // ── Respaldo ───────────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    const backup = {
      items: await ItemModel.find({}).lean(),
      stocks: await StockModel.find({}).lean(),
      movements: await MovementModel.find({}).lean(),
      batches: await BatchModel.find({}).lean(),
      fecha: new Date().toISOString(),
    };
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `almacen-lotes-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`Respaldo guardado en: ${backupPath}\n`);
  }

  // ── Revertir la revaluación de costos ─────────────────────────────────────
  let respaldoPrevio = null;
  let rutaRespaldo = backupArg;
  if (!rutaRespaldo) {
    const dir = path.join(__dirname, 'backups');
    const candidatos = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.startsWith('almacen-backup-')).sort()
      : [];
    if (candidatos.length > 0) rutaRespaldo = path.join(dir, candidatos[candidatos.length - 1]);
  }

  if (rutaRespaldo && fs.existsSync(rutaRespaldo)) {
    respaldoPrevio = JSON.parse(fs.readFileSync(rutaRespaldo, 'utf8'));
    console.log(`Revirtiendo costos con el respaldo: ${path.basename(rutaRespaldo)}`);
  } else {
    console.log('Aviso: no se encontró respaldo previo; no se restauran costos históricos.');
  }

  if (respaldoPrevio && !DRY_RUN) {
    let revertidos = 0;
    for (const item of respaldoPrevio.items || []) {
      if (item.costoUnitario === undefined) continue;
      await ItemModel.updateOne({ _id: item._id }, { $set: { costoUnitario: item.costoUnitario } });
      revertidos += 1;
    }
    console.log(`Costos de item restaurados: ${revertidos}\n`);
  }

  // ── Crear lotes por material ──────────────────────────────────────────────
  const items = await ItemModel.find({ deleted: false }).lean();
  const porCodigo = new Map();
  items.forEach((item) => {
    const codigo = normalizar(item.codigo);
    if (!codigo) return;
    if (!porCodigo.has(codigo)) porCodigo.set(codigo, []);
    porCodigo.get(codigo).push(item);
  });

  console.log('── Creando lotes por material ──');
  let lotesCreados = 0;
  let materialesOmitidos = 0;

  for (const [codigo, itemsMaterial] of porCodigo.entries()) {
    const ids = itemsMaterial.map((i) => i._id);
    const principal = itemsMaterial[0];

    const yaTieneLotes = await BatchModel.countDocuments({ itemId: { $in: ids } });
    if (yaTieneLotes > 0) {
      console.log(`  ${codigo}: ya tiene ${yaTieneLotes} lotes, se omite`);
      materialesOmitidos += 1;
      continue;
    }

    const movimientos = await MovementModel.find({ itemId: { $in: ids } }).sort({ createdAt: 1 }).lean();
    if (movimientos.length === 0) {
      console.log(`  ${codigo} (${principal.nombre}): sin movimientos, se omite`);
      materialesOmitidos += 1;
      continue;
    }

    // Cada INGRESO es un lote.
    const lotes = movimientos
      .filter((m) => m.tipo === 'INGRESO')
      .map((m) => ({
        itemId: principal._id,
        movementId: m._id,
        codigo,
        cantidad: m.cantidad || 0,
        cantidadDisponible: m.cantidad || 0,
        costoUnitario: m.costoUnitario || 0,
        monto: m.monto || 0,
        comentarios: m.comentarios || '',
        usuario: m.usuario || 'sistema',
        fechaIngreso: m.createdAt,
      }));

    // Las SALIDAS consumen lotes en orden FIFO.
    let consumoTotal = 0;
    for (const salida of movimientos.filter((m) => m.tipo === 'SALIDA')) {
      let porConsumir = salida.cantidad || 0;
      consumoTotal += porConsumir;
      for (const lote of lotes) {
        if (porConsumir <= 0) break;
        if (lote.cantidadDisponible <= 0) continue;
        const toma = Math.min(lote.cantidadDisponible, porConsumir);
        lote.cantidadDisponible -= toma;
        porConsumir -= toma;
      }
      if (porConsumir > 0) {
        console.log(`  ⚠️  ${codigo}: salida de ${salida.cantidad} excede el stock disponible en ${porConsumir}`);
      }
    }

    const saldoLotes = lotes.reduce((acc, l) => acc + l.cantidadDisponible, 0);
    const stockDoc = await StockModel.findOne({ itemId: principal._id }).lean();
    const stockReal = stockDoc?.cantidad || 0;

    const detalle = lotes
      .map((l) => `${l.cantidad}@${l.costoUnitario}->${l.cantidadDisponible}`)
      .join(' | ');
    console.log(`  ${codigo} (${principal.nombre}): ${lotes.length} lotes [${detalle}]`);
    console.log(`      saldo lotes: ${saldoLotes} | stock: ${stockReal}${saldoLotes === stockReal ? ' ✓' : ' ⚠️ DESCUADRE'}`);

    if (!DRY_RUN && lotes.length > 0) {
      await BatchModel.insertMany(lotes);
      lotesCreados += lotes.length;

      // El costo de referencia del material = costo del último ingreso.
      const ultimoIngreso = [...movimientos].reverse().find((m) => m.tipo === 'INGRESO');
      if (ultimoIngreso) {
        await StockModel.updateOne(
          { itemId: principal._id },
          { $set: { costoUnitarioActual: ultimoIngreso.costoUnitario || 0 } },
        );
      }
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Lotes creados: ${lotesCreados}`);
  console.log(`Materiales omitidos: ${materialesOmitidos}`);

  if (!DRY_RUN) {
    const totalLotes = await BatchModel.countDocuments();
    const lotesDisp = await BatchModel.aggregate([
      { $group: { _id: null, disponible: { $sum: '$cantidadDisponible' }, valor: { $sum: { $multiply: ['$cantidadDisponible', '$costoUnitario'] } } } },
    ]);
    const stockTotal = await StockModel.aggregate([{ $group: { _id: null, cantidad: { $sum: '$cantidad' } } }]);
    console.log(`\nLotes en BD: ${totalLotes}`);
    console.log(`Saldo lotes: ${lotesDisp[0]?.disponible || 0} | Stock: ${stockTotal[0]?.cantidad || 0}`);
    console.log(`Valor stock por lotes: S/ ${(lotesDisp[0]?.valor || 0).toFixed(2)}`);
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
