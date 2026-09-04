const UserModel = require('../../../models/seguridad/user');

/**
 * Servicio de usuarios y roles.
 * Centraliza la consulta de permisos por email autenticado.
 * Reemplaza la configuración por variables de entorno
 * (SOLPED_APPROVER_EMAILS, TIMESHEET_APPROVER_EMAILS) por una tabla `User`.
 */

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

/**
 * Obtiene el usuario por email (solo activos).
 */
const getUserByEmail = async (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return UserModel.findOne({ email: normalized, activo: true }).lean();
};

/**
 * ¿El usuario es aprobador del módulo logística (SOLPED)?
 * Devuelve true si: es admin global O logistica.esAprobador.
 */
const isLogisticaApprover = async (email) => {
  if (!email) return false;
  const user = await getUserByEmail(email);
  if (!user) return false;
  return Boolean(user.admin || user.logistica?.esAprobador);
};

/**
 * ¿El usuario es aprobador del módulo equipo (timesheets)?
 * Devuelve true si: es admin global O equipo.esAprobador.
 */
const isEquipoApprover = async (email) => {
  if (!email) return false;
  const user = await getUserByEmail(email);
  if (!user) return false;
  return Boolean(user.admin || user.equipo?.esAprobador);
};

/**
 * ¿El usuario puede hacer override contable en finanzas?
 * Roles válidos: 'finanzas', 'contabilidad', 'admin' (o admin global).
 */
const canFinanzasOverride = async (email) => {
  if (!email) return false;
  const user = await getUserByEmail(email);
  if (!user) return false;
  if (user.admin) return true;
  return ['finanzas', 'contabilidad', 'admin'].includes(
    String(user.finanzas?.rol || '').trim().toLowerCase(),
  );
};

/**
 * Devuelve el resumen de roles de un usuario (para el JWT/sesión o debug).
 */
const getUserRoles = async (email) => {
  const user = await getUserByEmail(email);
  if (!user) return { admin: false, logistica: false, equipo: false, finanzas: false };

  return {
    admin: Boolean(user.admin),
    logistica: Boolean(user.logistica?.esAprobador),
    equipo: Boolean(user.equipo?.esAprobador),
    finanzas: ['finanzas', 'contabilidad', 'admin'].includes(
      String(user.finanzas?.rol || '').trim().toLowerCase(),
    ),
  };
};

module.exports = {
  normalizeEmail,
  getUserByEmail,
  isLogisticaApprover,
  isEquipoApprover,
  canFinanzasOverride,
  getUserRoles,
};
