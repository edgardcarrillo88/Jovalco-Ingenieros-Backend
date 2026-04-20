const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/v1/logistica/controller');

router.get('/logistica/pep-options', controller.GetPepOptions);
router.post('/logistica/solped', controller.CreateSolped);
router.put('/logistica/solped/:id', controller.UpdateSolped);
router.get('/logistica/solped', controller.GetSolpeds);
router.get('/logistica/approvals', controller.GetApprovalQueue);
router.patch('/logistica/approvals/:id', controller.ApproveSolped);
router.get('/logistica/dashboard', controller.GetDashboard);

module.exports = router;
