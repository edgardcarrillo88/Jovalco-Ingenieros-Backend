const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/v1/almacen/controller');

// Categorías
router.get('/almacen/categories', controller.listCategories);
router.post('/almacen/categories', controller.createCategory);

// Items
router.get('/almacen/items', controller.listItems);
router.post('/almacen/items', controller.createItem);
router.put('/almacen/items/:id', controller.updateItem);

// Stock
router.get('/almacen/stock', controller.getStock);

// Movimientos (ingreso/salida/kardex)
router.post('/almacen/stock/ingreso', controller.registerIngreso);
router.post('/almacen/stock/salida', controller.registerSalida);
router.post('/almacen/stock/salidas/multiples', controller.registerMultipleSalidas);
router.get('/almacen/kardex', controller.getKardex);
router.get('/almacen/kardex/:itemId', controller.getKardexByItem);

// Dashboard
router.get('/almacen/dashboard', controller.getDashboard);

module.exports = router;
