/**
 * Service del módulo Administración (personal).
 *
 * Contiene la lógica de negocio del módulo y no depende de Express
 * (no recibe req/res/next), según la arquitectura del proyecto.
 *
 * Regla de negocio del estado contractual
 * ───────────────────────────────────────
 * El estado del contrato se DERIVA al leer (no se persiste) a partir de la
 * fecha de vencimiento del contrato:
 *
 *   - fecha de vencimiento = (fechaRenovacion si hay renovación, si no fechaIngreso)
 *                           + (tiempoRenovacion | tiempoContrato) meses
 *   - Vencido          → la fecha de vencimiento ya pasó
 *   - Próximo a vencer → vence dentro de los próximos 30 días (1 mes)
 *   - Vigente          → vence en más de 30 días
 *
 * `Pendiente de firma` y `Cesado` son estados manuales y tienen prioridad:
 * no se recalculan.
 */
const PersonalModel = require('../../../models/administracion/personal');

/** Estados que se administran manualmente y no se recalculan. */
const ESTADO_MANUAL = {
  PENDIENTE_FIRMA: 'Pendiente de firma',
  CESADO: 'Cesado',
};

const ESTADOS_MANUALES = Object.values(ESTADO_MANUAL);

const ESTADO_CONTRATO = {
  VIGENTE: 'Vigente',
  PROXIMO_A_VENCER: 'Próximo a vencer',
  VENCIDO: 'Vencido',
};

/** Días de anticipación con los que un contrato se considera "próximo a vencer" (1 mes). */
const DIAS_PROXIMO_A_VENCER = 30;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Normaliza una fecha al inicio del día para comparar por día calendario. */
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Suma meses a una fecha respetando el fin de mes (mismo criterio que date-fns
 * `addMonths`), para que la fecha mostrada y el estado calculado coincidan.
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
const addMonths = (date, months) => {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const daysInTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, daysInTargetMonth));
  return result;
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Calcula la fecha de vencimiento del contrato.
 * Si existe renovación (fecha + tiempo) se toma como base la renovación.
 * @param {Object} personal
 * @returns {Date|null}
 */
const calcularFechaVencimientoContrato = (personal = {}) => {
  const fechaIngreso = toDate(personal.fechaIngreso);
  const fechaRenovacion = toDate(personal.fechaRenovacion);
  const tiempoRenovacion = Number(personal.tiempoRenovacion) || 0;

  const hasRenovacion = Boolean(fechaRenovacion && tiempoRenovacion > 0);
  const startDate = hasRenovacion ? fechaRenovacion : fechaIngreso;
  const months = hasRenovacion ? tiempoRenovacion : Number(personal.tiempoContrato) || 0;

  if (!startDate) return null;
  return addMonths(startDate, months > 0 ? months : 1);
};

/**
 * Días calendario restantes hasta la fecha de vencimiento.
 * Negativo si ya venció.
 * @param {Date} fechaVencimiento
 * @param {Date} [hoy]
 * @returns {number}
 */
const diasHastaVencimiento = (fechaVencimiento, hoy = new Date()) =>
  Math.round((startOfDay(fechaVencimiento).getTime() - startOfDay(hoy).getTime()) / MS_POR_DIA);

/**
 * Deriva el estado del contrato de un registro de personal.
 * @param {Object} personal
 * @param {Date} [hoy] fecha de referencia (facilita pruebas deterministas)
 * @returns {string}
 */
const calcularEstadoContrato = (personal = {}, hoy = new Date()) => {
  const estadoActual = String(personal.estado || '').trim();
  if (ESTADOS_MANUALES.includes(estadoActual)) return estadoActual;

  const fechaVencimiento = calcularFechaVencimientoContrato(personal);
  if (!fechaVencimiento) return ESTADO_CONTRATO.VIGENTE;

  const diasRestantes = diasHastaVencimiento(fechaVencimiento, hoy);
  if (diasRestantes < 0) return ESTADO_CONTRATO.VENCIDO;
  if (diasRestantes <= DIAS_PROXIMO_A_VENCER) return ESTADO_CONTRATO.PROXIMO_A_VENCER;
  return ESTADO_CONTRATO.VIGENTE;
};

/**
 * Añade al registro el estado derivado y la fecha de vencimiento calculada.
 * @param {Object} personal documento plano de Personal
 * @param {Date} [hoy]
 * @returns {Object}
 */
const withEstadoContrato = (personal, hoy = new Date()) => {
  const fechaVencimiento = calcularFechaVencimientoContrato(personal);
  return {
    ...personal,
    estado: calcularEstadoContrato(personal, hoy),
    fechaVencimientoContrato: fechaVencimiento ? fechaVencimiento.toISOString() : null,
  };
};

/**
 * Lista el personal activo con su estado contractual derivado.
 * @returns {Promise<Array>}
 */
const listarPersonal = async () => {
  const personal = await PersonalModel.find({ deleted: false })
    .sort({ createdAt: -1 })
    .lean();

  return personal.map((registro) => withEstadoContrato(registro));
};

/**
 * Obtiene un registro de personal activo por id.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
const obtenerPersonalPorId = async (id) => {
  const personal = await PersonalModel.findOne({ _id: id, deleted: false }).lean();
  if (!personal) return null;
  return withEstadoContrato(personal);
};

/**
 * Agrupa una lista por una clave, devolviendo el formato { _id, cantidad }.
 * @param {Array} registros
 * @param {(registro: Object) => string} obtenerClave
 * @returns {Array<{_id: string, cantidad: number}>}
 */
const agruparPor = (registros, obtenerClave) => {
  const conteos = new Map();
  registros.forEach((registro) => {
    const clave = obtenerClave(registro);
    conteos.set(clave, (conteos.get(clave) || 0) + 1);
  });

  return [...conteos.entries()]
    .map(([clave, cantidad]) => ({ _id: clave || null, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
};

/**
 * Estados excluidos del gasto de planilla.
 * Un trabajador cesado ya no genera gasto de planilla.
 */
const ESTADOS_EXCLUIDOS_COSTO_PLANILLA = [ESTADO_MANUAL.CESADO];

/** Convierte un valor a número; usa 0 cuando no es un número válido. */
const toNumero = (value) => {
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : 0;
};

/**
 * Gasto mensual de planilla: suma de los montos del personal no cesado.
 * Monto por persona = `sueldoPlanilla` + `sueldoRh`.
 * Los sueldos no informados cuentan como 0.
 * @param {Array} personalConEstado
 * @returns {{ gastoPlanilla: number, personalConsiderado: number }}
 */
const calcularGastoPlanilla = (personalConEstado = []) => {
  const considerados = personalConEstado.filter(
    (registro) => !ESTADOS_EXCLUIDOS_COSTO_PLANILLA.includes(registro.estado),
  );

  const gastoTotal = considerados.reduce(
    (acumulado, registro) =>
      acumulado + toNumero(registro.sueldoPlanilla) + toNumero(registro.sueldoRh),
    0,
  );

  return {
    gastoPlanilla: Number(gastoTotal.toFixed(2)),
    personalConsiderado: considerados.length,
  };
};

/**
 * Estadísticas del personal activo, con la distribución por estado contractual
 * calculada con la misma regla que el listado.
 * @returns {Promise<Object>}
 */
const obtenerEstadisticasPersonal = async () => {
  const personal = await PersonalModel.find({ deleted: false }).lean();
  const personalConEstado = personal.map((registro) => withEstadoContrato(registro));

  return {
    totalPersonal: personalConEstado.length,
    ...calcularGastoPlanilla(personalConEstado),
    personalPorArea: agruparPor(personalConEstado, (registro) => registro.area),
    personalPorCargo: agruparPor(personalConEstado, (registro) => registro.cargo),
    personalPorEstado: agruparPor(personalConEstado, (registro) => registro.estado),
  };
};

module.exports = {
  ESTADOS_MANUALES,
  ESTADO_MANUAL,
  ESTADO_CONTRATO,
  DIAS_PROXIMO_A_VENCER,
  ESTADOS_EXCLUIDOS_COSTO_PLANILLA,
  calcularFechaVencimientoContrato,
  diasHastaVencimiento,
  calcularEstadoContrato,
  withEstadoContrato,
  calcularGastoPlanilla,
  listarPersonal,
  obtenerPersonalPorId,
  obtenerEstadisticasPersonal,
};
