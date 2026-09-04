const mongoose = require('mongoose');

/**
 * Modelo User (colección 'User').
 * Fuente única para autorización por roles de la intranet.
 *
 * Se usa para determinar, a partir del email autenticado (NextAuth),
 * qué permisos tiene el usuario en cada módulo:
 *  - logistica: { esAprobador }  → puede aprobar/rechazar SOLPED
 *  - equipo:    { esAprobador }  → puede aprobar/rechazar timesheets
 *  - finanzas:  { rol }          → 'finanzas' | 'contabilidad' | 'admin' (override contable)
 *  - admin:     acceso global
 *
 * La colección se puebla manualmente o mediante un endpoint/seed de usuarios.
 */
const UserSchema = mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    nombre: { type: String, default: '', trim: true },
    activo: { type: Boolean, default: true, index: true },

    // Roles por módulo
    admin: { type: Boolean, default: false },

    logistica: {
      esAprobador: { type: Boolean, default: false },
    },

    equipo: {
      esAprobador: { type: Boolean, default: false },
    },

    finanzas: {
      // 'finanzas' | 'contabilidad' | 'admin' | ''
      rol: { type: String, default: '', trim: true },
    },

    // Auditoría
    createdBy: { type: String, default: 'sistema', trim: true },
    updatedBy: { type: String, default: 'sistema', trim: true },
  },
  {
    timestamps: true,
  },
);

UserSchema.index({ email: 1, activo: 1 });

const User = mongoose.model('User', UserSchema, 'User');
module.exports = User;
