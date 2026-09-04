const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/v1/finanzas/controller');
const authMiddleware = require('../../../middleware/v1/auth');

// El módulo finanzas requiere autenticación (Bearer token de NextAuth).
// Se permite OPTIONS para el preflight de CORS.
router.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  return authMiddleware(req, res, next);
});

router.get('/finanzas/valuations/pending', controller.getInvoiceCandidates);
router.get('/finanzas/accounting/catalog', controller.getAccountingCatalog);
router.get('/finanzas/financial-statement', controller.getFinancialStatement);
router.post('/finanzas/invoices/from-valuation', controller.generateInvoiceFromValuation);
router.get('/finanzas/invoices', controller.getInvoices);
router.patch('/finanzas/invoices/:id/status', controller.updateInvoiceStatus);

router.get('/finanzas/payables', controller.getPayables);
router.get('/finanzas/payables/payments-history', controller.getPaymentsHistory);
router.post('/finanzas/payables/recurrent', controller.createRecurrentPayable);
router.get('/finanzas/recurrent', controller.getRecurrentPayables);
router.patch('/finanzas/recurrent/:id/active', controller.toggleRecurrentPayableActive);
router.put('/finanzas/recurrent/:id', controller.updateRecurrentPayableById);
router.delete('/finanzas/recurrent/:id', controller.deleteRecurrentPayableById);
router.patch('/finanzas/payables/recurrent/:id/status', controller.updateRecurrentPayableStatus);
router.patch('/finanzas/payables/solped/:id/status', controller.updateSolpedPaymentStatus);

router.get('/finanzas/dashboard', controller.getDashboard);

module.exports = router;
