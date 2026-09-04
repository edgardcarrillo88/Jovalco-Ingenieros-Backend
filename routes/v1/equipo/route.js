const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/v1/equipo/controller');
const authMiddleware = require('../../../middleware/v1/auth');

// El módulo equipo requiere autenticación (Bearer token de NextAuth).
// Se permite OPTIONS para el preflight de CORS.
router.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  return authMiddleware(req, res, next);
});

router.get('/equipo/pep-options', controller.getPepOptions);
router.post('/equipo/timesheets', controller.createTimesheet);
router.put('/equipo/timesheets/:id', controller.updateTimesheet);
router.get('/equipo/timesheets', controller.getTimesheets);
router.get('/equipo/approvals', controller.getApprovalQueue);
router.patch('/equipo/approvals/:id', controller.approveTimesheet);
router.get('/equipo/dashboard', controller.getDashboard);

module.exports = router;
