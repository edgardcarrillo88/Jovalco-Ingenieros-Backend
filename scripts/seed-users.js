/**
 * Seed de usuarios (tabla User).
 * Crea/actualiza usuarios por defecto con sus roles por módulo.
 *
 * Uso:
 *   node scripts/seed-users.js
 *
 * Los usuarios se identifican por email (único). Si ya existen, se actualizan
 * sus roles según lo definido en este archivo.
 *
 * IMPORTANTE: ajusta los emails y roles según los usuarios reales de la empresa.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const UserModel = require('../models/seguridad/user');

const MONGO_URI = `mongodb+srv://eacarrilloiparraguirre_db_user:${process.env.MONGO_DB_PASS}@clusterjovalco.bzehbnn.mongodb.net/Project?retryWrites=true&w=majority`;

// Usuarios por defecto. Agrega aquí los aprobadores reales.
const USERS_SEED = [
  {
    email: 'e2e@jovalco.com',
    nombre: 'Usuario E2E',
    activo: true,
    admin: false,
    logistica: { esAprobador: true },
    equipo: { esAprobador: true },
    finanzas: { rol: 'finanzas' },
  },
  // {
  //   email: 'admin@jovalco.com',
  //   nombre: 'Administrador',
  //   activo: true,
  //   admin: true,
  //   logistica: { esAprobador: true },
  //   equipo: { esAprobador: true },
  //   finanzas: { rol: 'admin' },
  // },
];

const seedUsers = async () => {
  let results = { creados: 0, actualizados: 0 };

  for (const seed of USERS_SEED) {
    const email = String(seed.email).trim().toLowerCase();
    const existente = await UserModel.findOne({ email });

    if (!existente) {
      await UserModel.create({ ...seed, email });
      results.creados += 1;
      console.log(`[seed-users] Creado: ${email}`);
    } else {
      existente.nombre = seed.nombre ?? existente.nombre;
      existente.activo = seed.activo ?? existente.activo;
      existente.admin = seed.admin ?? existente.admin;
      if (seed.logistica) existente.logistica = { ...existente.logistica, ...seed.logistica };
      if (seed.equipo) existente.equipo = { ...existente.equipo, ...seed.equipo };
      if (seed.finanzas) existente.finanzas = { ...existente.finanzas, ...seed.finanzas };
      await existente.save();
      results.actualizados += 1;
      console.log(`[seed-users] Actualizado: ${email}`);
    }
  }

  return results;
};

const run = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    const result = await seedUsers();
    console.log(`[seed-users] Listo. Creados: ${result.creados}, Actualizados: ${result.actualizados}`);
  } catch (error) {
    console.error('[seed-users] Error:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
