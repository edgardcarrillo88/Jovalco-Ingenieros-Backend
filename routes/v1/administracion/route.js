const express = require('express');
const adminRouter = express.Router();
const adminController = require('../../../controllers/v1/administracion/controller');
const authMiddleware = require('../../../middleware/v1/auth');

// El módulo administración requiere autenticación (Bearer token de NextAuth).
// Se permite OPTIONS para el preflight de CORS.
adminRouter.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  return authMiddleware(req, res, next);
});

/**
 * Personal Routes
 */

// Obtener todos los registros de personal
adminRouter.get('/administracion/getpersonal', adminController.GetPersonal);

// Obtener un registro de personal específico por ID
adminRouter.get('/administracion/getpersonal/:id', adminController.GetPersonalById);

// Crear un nuevo registro de personal
adminRouter.post('/administracion/createpersonal', adminController.CreatePersonal);

// Actualizar un registro de personal
adminRouter.put('/administracion/updatepersonal/:id', adminController.UpdatePersonal);

// Eliminar un registro de personal
adminRouter.delete('/administracion/deletepersonal/:id', adminController.DeletePersonal);

// Obtener estadísticas de personal
adminRouter.get('/administracion/getestadisticas', adminController.GetEstadisticas);

module.exports = adminRouter;
