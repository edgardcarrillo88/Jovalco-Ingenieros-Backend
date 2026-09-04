const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/v1/seguridad/controller');
const userController = require('../../../controllers/v1/seguridad/userController');
const authMiddleware = require('../../../middleware/v1/auth');

// El módulo seguridad requiere autenticación (Bearer token de NextAuth).
// Se permite OPTIONS para el preflight de CORS.
router.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  return authMiddleware(req, res, next);
});

// Gestión de usuarios (tabla User)
router.get('/seguridad/users', userController.listUsers);
router.post('/seguridad/users', userController.createUser);
router.patch('/seguridad/users/:id', userController.updateUser);

// Dashboard
router.get('/seguridad/dashboard', controller.getDashboard);

// Personal / Fichas
router.get('/seguridad/personal', controller.listFichas);
router.get('/seguridad/personal/:id', controller.getFicha);
router.post('/seguridad/personal/:id/examen', controller.addExamen);
router.patch('/seguridad/personal/:id/examen/:examenIdx', controller.updateExamen);
router.post('/seguridad/personal/:id/certificacion', controller.addCertificacion);
router.patch('/seguridad/personal/:id/certificacion/:certIdx', controller.updateCertificacion);
router.post('/seguridad/personal/:id/capacitacion', controller.addCapacitacion);
router.post('/seguridad/personal/:id/epp', controller.addEntregaEPP);
router.get('/seguridad/personal/:id/epp/ultimas', controller.getUltimasEntregasEPP);

// Documentos (catálogo maestro)
router.get('/seguridad/documentos', controller.listDocumentos);
router.post('/seguridad/documentos', controller.createDocumento);
router.patch('/seguridad/documentos/:id', controller.updateDocumento);

// Checklist
router.get('/seguridad/checklist/config', controller.getChecklistConfig);
router.post('/seguridad/checklist/config', controller.saveChecklistConfig);
router.get('/seguridad/checklist/resumen-todos', controller.getResumenTodosChecklist);
router.post('/seguridad/checklist/asignar-personal', controller.asignarPersonalAPEP);
router.get('/seguridad/checklist/cumplimiento', controller.getCumplimiento);
router.post('/seguridad/checklist/cumplimiento', controller.saveCumplimiento);
router.get('/seguridad/checklist/resumen', controller.getResumenChecklist);

// Eventos
router.get('/seguridad/eventos', controller.listEventos);
router.post('/seguridad/eventos', controller.createEvento);
router.patch('/seguridad/eventos/:id', controller.updateEvento);
router.post('/seguridad/eventos/:id/acciones', controller.addAccionCorrectiva);
router.patch('/seguridad/eventos/:id/acciones/:accIdx', controller.updateAccionCorrectiva);

// Catálogos
router.get('/seguridad/catalogos/:tipo', controller.listCatalogo);
router.post('/seguridad/catalogos', controller.createCatalogo);

module.exports = router;
