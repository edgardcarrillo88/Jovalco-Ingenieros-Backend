/**
 * Servicio compartido del catálogo PEP (Comercial ↔ Logística ↔ Almacén).
 *
 * Centraliza las consultas a `Comercial` (proyectos) y `ComercialCBS`
 * (elementos PEP) que determinan:
 *   - Qué PEP están adjudicados.
 *   - Qué elementos PEP están habilitados (Carga = "Si") y a qué PEP pertenecen.
 *
 * Estas reglas las consumen los módulos que registran movimientos o solicitudes
 * contra un PEP (Logística para SOLPED, Almacén para ingresos/salidas).
 */
const ComercialModel = require('../../../models/comercial/comercial');
const ComercialCBSModel = require('../../../models/comercial/comercial_CBS');

// Un elemento PEP solo es utilizable cuando su fila CBS tiene Carga = "Si".
const CARGA_HABILITADA = { $regex: '^\\s*si\\s*$', $options: 'i' };

// Un proyecto solo es utilizable como destino cuando está adjudicado.
const ESTADO_ADJUDICADO = { $regex: '^\\s*adjudicado\\s*$', $options: 'i' };

/**
 * Extrae el PEP raíz contenido en un código de elemento PEP.
 * Ej: "J.2026.001/001.01" → "J.2026.001/001".
 */
const extractPepFromElemento = (elementoPEP = '') => {
  const cleaned = String(elementoPEP || '').trim();
  if (!cleaned) return '';

  const match = cleaned.match(/^([^/]+\/[0-9]+)/);
  return match ? match[1] : '';
};

/** Devuelve el conjunto de PEP adjudicados (no eliminados). */
const getAdjudicadoPepSet = async () => {
  const peps = await ComercialModel.distinct('PEP', {
    deleted: { $ne: true },
    Estado: ESTADO_ADJUDICADO,
    PEP: { $exists: true, $ne: '' },
  });

  return new Set(peps.map((pep) => String(pep || '').trim()).filter(Boolean));
};

/** Indica si un PEP existe y está adjudicado. */
const isPepAdjudicado = async (pep) => {
  const pepLimpio = String(pep || '').trim();
  if (!pepLimpio) return false;

  const found = await ComercialModel.findOne({
    deleted: { $ne: true },
    PEP: pepLimpio,
    Estado: ESTADO_ADJUDICADO,
  })
    .select('_id')
    .lean();

  return Boolean(found);
};

/**
 * Valida que un elemento PEP esté habilitado para un PEP adjudicado.
 * Retorna { ok, message } para que el llamador decida el código HTTP.
 *
 * Orden de validación: PEP informado → elemento informado → PEP adjudicado →
 * elemento habilitado y perteneciente a ese PEP.
 */
const validateElementoHabilitado = async ({ pep, elementoPEP } = {}) => {
  const pepLimpio = String(pep || '').trim();
  const elementoLimpio = String(elementoPEP || '').trim();

  if (!pepLimpio) {
    return { ok: false, message: 'Debe seleccionar un PEP de destino' };
  }
  if (!elementoLimpio) {
    return { ok: false, message: 'Debe seleccionar un elemento PEP de destino' };
  }

  if (!(await isPepAdjudicado(pepLimpio))) {
    return {
      ok: false,
      message: 'El PEP de destino no existe o no está adjudicado',
    };
  }

  const elemento = await ComercialCBSModel.findOne({
    deleted: { $ne: true },
    ElementoPEP: elementoLimpio,
    Carga: CARGA_HABILITADA,
  })
    .select('ElementoPEP PEP')
    .lean();

  if (!elemento) {
    return {
      ok: false,
      message: 'El elemento PEP no está habilitado para el PEP seleccionado',
    };
  }

  const pepDelElemento =
    String(elemento.PEP || '').trim() || extractPepFromElemento(elemento.ElementoPEP);

  // El elemento debe pertenecer al PEP indicado.
  if (pepDelElemento !== pepLimpio) {
    return {
      ok: false,
      message: 'El elemento PEP no está habilitado para el PEP seleccionado',
    };
  }

  return { ok: true };
};

module.exports = {
  extractPepFromElemento,
  getAdjudicadoPepSet,
  isPepAdjudicado,
  validateElementoHabilitado,
};
