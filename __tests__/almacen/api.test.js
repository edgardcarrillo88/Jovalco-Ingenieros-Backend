/**
 * Tests de integración HTTP (Supertest) del módulo Almacén.
 * Levanta una app Express mínima con las rutas reales del módulo,
 * usando mongodb-memory-server.
 *
 * Cubre:
 *  - Autenticación (401 sin token).
 *  - CRUD de categorías e items (incluye autogeneración del código).
 *  - Búsqueda de items por categoría, código, nombre y tipo.
 *  - Ingreso/salida de stock, kardex y sincronización del costo unitario base.
 *  - Validaciones (duplicados, ObjectId, stock insuficiente).
 *  - Destino PEP: PEP adjudicado + elemento PEP habilitado.
 */
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { connect, disconnect, clearDatabase } = require("../helpers/mongo");
const almacenRoutes = require("../../routes/v1/almacen/route");
const ItemModel = require("../../models/almacen/item");
const CategoryModel = require("../../models/almacen/category");
const StockModel = require("../../models/almacen/stock");
const MovementModel = require("../../models/almacen/movement");
const BatchModel = require("../../models/almacen/batch");
const ComercialModel = require("../../models/comercial/comercial");
const ComercialCBSModel = require("../../models/comercial/comercial_CBS");

const TEST_SECRET = "test-jwt-secret-almacen-2026";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", almacenRoutes);
  return app;
};

const firmarToken = (email = "almacen@jovalco.com") =>
  jwt.sign(
    { sub: "u1", email, name: "Almacen", role: "admin" },
    TEST_SECRET,
    { expiresIn: "1h", algorithm: "HS256" },
  );

let app;
let token;

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = TEST_SECRET;
  await connect();
  app = createApp();
  token = firmarToken();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  delete process.env.AUTH_JWT_SECRET;
  await disconnect();
});

describe("Autenticación Almacén", () => {
  test("rechaza sin token con 401", async () => {
    const res = await request(app).get("/api/v1/almacen/categories");
    expect(res.status).toBe(401);
  });

  test("rechaza token inválido con 401", async () => {
    const res = await request(app)
      .get("/api/v1/almacen/categories")
      .set("Authorization", "Bearer invalido");
    expect(res.status).toBe(401);
  });

  test("permite OPTIONS sin token", async () => {
    const res = await request(app).options("/api/v1/almacen/categories");
    expect(res.status).toBe(200);
  });
});

describe("Categorías", () => {
  test("crea y lista categorías", async () => {
    const create = await request(app)
      .post("/api/v1/almacen/categories")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Interruptores" });

    expect(create.status).toBe(201);
    expect(create.body.data.nombre).toBe("Interruptores");
    // El costo unitario base pertenece al item, no a la categoría.
    expect(create.body.data.costoUnitario).toBeUndefined();

    const list = await request(app)
      .get("/api/v1/almacen/categories")
      .set("Authorization", `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(1);
  });

  test("rechaza categoría duplicada", async () => {
    await request(app)
      .post("/api/v1/almacen/categories")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Interruptores" });

    const dup = await request(app)
      .post("/api/v1/almacen/categories")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Interruptores" });

    expect(dup.status).toBe(400);
    expect(dup.body.message).toMatch(/ya existe/i);
  });

  test("rechaza categoría sin nombre", async () => {
    const res = await request(app)
      .post("/api/v1/almacen/categories")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("Items", () => {
  test("crea item y su stock inicial", async () => {
    const res = await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Interruptor 3P", categoria: "Interruptores", tipo: "Componente", costoUnitario: 30 });

    expect(res.status).toBe(201);
    expect(res.body.data.nombre).toBe("Interruptor 3P");

    const stock = await StockModel.findOne({ itemId: res.body.data._id });
    expect(stock).not.toBeNull();
    expect(stock.cantidad).toBe(0);
  });

  test("autogenera el código de material cuando no se informa", async () => {
    const res = await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Item Sin Codigo", categoria: "General", tipo: "Componente" });

    expect(res.status).toBe(201);
    expect(res.body.data.codigo).toMatch(/^MAT-\d{4}$/);
  });

  test("genera códigos correlativos distintos", async () => {
    const primero = await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Item A", categoria: "General" });
    const segundo = await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Item B", categoria: "General" });

    expect(primero.body.data.codigo).not.toBe(segundo.body.data.codigo);
    expect(primero.body.data.codigo).toMatch(/^MAT-\d{4}$/);
    expect(segundo.body.data.codigo).toMatch(/^MAT-\d{4}$/);
  });

  test("respeta el código informado por el usuario", async () => {
    const res = await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Item Codigo Manual", codigo: "MAT-9999", categoria: "General" });

    expect(res.status).toBe(201);
    expect(res.body.data.codigo).toBe("MAT-9999");
  });

  test("rechaza item duplicado por nombre", async () => {
    const payload = { nombre: "Cable 14 AWG", categoria: "Cables", tipo: "Componente" };
    const primero = await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send(payload);
    const segundo = await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send(payload);

    // El material ya registrado se reutiliza en lugar de crear un duplicado.
    expect(primero.status).toBe(201);
    expect(segundo.status).toBe(200);
    expect(segundo.body.reutilizado).toBe(true);
    expect(segundo.body.data._id).toBe(primero.body.data._id);

    const total = await ItemModel.countDocuments({ deleted: false, nombre: "Cable 14 AWG" });
    expect(total).toBe(1);
  });

  test("un mismo nombre con distinta categoría crea materiales distintos", async () => {
    const cableUno = await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send({ nombre: "Cable 14 AWG", categoria: "Cables" });
    const cableDos = await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send({ nombre: "Cable 14 AWG", categoria: "Ferreteria" });

    expect(cableUno.status).toBe(201);
    expect(cableDos.status).toBe(201);
    expect(cableUno.body.data.codigo).not.toBe(cableDos.body.data.codigo);
  });

  test("rechaza item duplicado por código", async () => {
    await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Item Codigo 1", codigo: "MAT-7777", categoria: "General" });

    const dup = await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Item Codigo 2", codigo: "MAT-7777", categoria: "General" });

    expect(dup.status).toBe(400);
    expect(dup.body.message).toMatch(/ya existe/i);
  });

  test("lista items con filtro por tipo", async () => {
    await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send({ nombre: "Taladro", categoria: "Herramientas", tipo: "Herramienta" });
    await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send({ nombre: "Tornillo", categoria: "Ferreteria", tipo: "Componente" });

    const res = await request(app)
      .get("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .query({ tipo: "Herramienta" });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].nombre).toBe("Taladro");
  });

  test("busca items por categoría, código y nombre", async () => {
    await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send({ nombre: "Cable THW", codigo: "MAT-0001", categoria: "Cables" });
    await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send({ nombre: "Breaker", codigo: "MAT-0002", categoria: "Interruptores" });

    const porCategoria = await request(app)
      .get("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .query({ categoria: "Cables" });
    expect(porCategoria.body.data.length).toBe(1);
    expect(porCategoria.body.data[0].nombre).toBe("Cable THW");

    const porCodigo = await request(app)
      .get("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .query({ codigo: "MAT-0002" });
    expect(porCodigo.body.data.length).toBe(1);
    expect(porCodigo.body.data[0].nombre).toBe("Breaker");

    const porNombre = await request(app)
      .get("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .query({ nombre: "cable" });
    expect(porNombre.body.data.length).toBe(1);
    expect(porNombre.body.data[0].codigo).toBe("MAT-0001");
  });

  test("la búsqueda devuelve el stock disponible", async () => {
    const itemRes = await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Item Con Stock", categoria: "General", costoUnitario: 10 });
    const itemId = itemRes.body.data._id;

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 7, monto: 70, costoUnitarioActual: 10, destino: "ALMACEN" });

    const res = await request(app)
      .get("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .query({ nombre: "Item Con Stock" });

    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].cantidadDisponible).toBe(7);
    expect(res.body.data[0].costoUnitarioActual).toBe(10);
  });

  test("la búsqueda devuelve una sola fila por código con el stock sumado", async () => {
    // Dos items con el MISMO código representan el mismo material: la búsqueda
    // debe devolver una única fila con el stock total.
    const itemA = await ItemModel.create({ codigo: "MAT-5000", nombre: "Material Unico", categoria: "General", tipo: "Componente" });
    const itemB = await ItemModel.create({ codigo: "MAT-5000", nombre: "Material Unico", categoria: "General", tipo: "Componente" });
    await StockModel.create({ itemId: itemA._id, cantidad: 4, costoUnitarioActual: 10 });
    await StockModel.create({ itemId: itemB._id, cantidad: 6, costoUnitarioActual: 10 });

    const res = await request(app)
      .get("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .query({ codigo: "MAT-5000" });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].codigo).toBe("MAT-5000");
    expect(res.body.data[0].cantidadDisponible).toBe(10);
  });

  test("la búsqueda filtra por tipo además de categoría, código y nombre", async () => {
    await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send({ nombre: "Martillo", categoria: "Herramientas", tipo: "Herramienta" });
    await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send({ nombre: "Clavo", categoria: "Herramientas", tipo: "Componente" });

    const res = await request(app)
      .get("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .query({ categoria: "Herramientas", tipo: "Herramienta" });

    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].nombre).toBe("Martillo");
  });

  test("actualizar item con id inválido devuelve 400", async () => {
    const res = await request(app)
      .put("/api/v1/almacen/items/id-invalido")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "X" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/inválido/);
  });

  test("actualizar el costo base no altera el costo de los lotes", async () => {
    const creado = await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Material Modal", categoria: "General", tipo: "Componente", costoUnitario: 10 });
    const itemId = creado.body.data._id;

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 30, costoUnitarioActual: 10, destino: "ALMACEN" });

    const res = await request(app)
      .put(`/api/v1/almacen/items/${itemId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ costoUnitario: 75 });

    expect(res.status).toBe(200);

    // El costo del lote se conserva: es el costo real del ingreso.
    const lote = await BatchModel.findOne({ itemId }).lean();
    expect(lote.costoUnitario).toBe(10);
  });
});

describe("Stock (ingreso/salida)", () => {
  let itemId;

  const crearItem = async () => {
    const res = await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Item Stock", categoria: "General", tipo: "Componente", costoUnitario: 50 });
    itemId = res.body.data._id;
  };

  test("registra ingreso y aumenta stock", async () => {
    await crearItem();

    const res = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 10, monto: 500, costoUnitarioActual: 50, destino: "ALMACEN" });

    expect(res.status).toBe(201);
    expect(res.body.data.cantidad).toBe(10);
    expect(res.body.data.montoTotalIngreso).toBe(500);

    const movs = await MovementModel.find({ itemId });
    expect(movs.length).toBe(1);
    expect(movs[0].tipo).toBe("INGRESO");
  });

  test("el costo unitario base del item se actualiza con el último costo de ingreso", async () => {
    await crearItem();

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 2, monto: 100, costoUnitarioActual: 50, destino: "ALMACEN" });

    const segundo = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 240, costoUnitarioActual: 80, destino: "ALMACEN" });

    expect(segundo.status).toBe(201);

    const item = await ItemModel.findById(itemId).lean();
    expect(item.costoUnitario).toBe(80);
  });

  test("el stock se explota por lote (una fila por ingreso, con su costo)", async () => {
    await crearItem();

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 4, monto: 200, costoUnitarioActual: 50, destino: "ALMACEN" });

    const res = await request(app)
      .get("/api/v1/almacen/stock")
      .set("Authorization", `Bearer ${token}`);

    const items = res.body.data.grupos[0].items;
    expect(items.length).toBe(1);
    expect(items[0].cantidad).toBe(4);
    expect(items[0].costoUnitarioActual).toBe(50);
    expect(items[0].totalUnitarioBase).toBe(200);
  });

  test("el ingreso NO revalúa los lotes existentes", async () => {
    await crearItem();

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 2, monto: 100, costoUnitarioActual: 50, destino: "ALMACEN" });

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 240, costoUnitarioActual: 80, destino: "ALMACEN" });

    const res = await request(app)
      .get("/api/v1/almacen/stock")
      .set("Authorization", `Bearer ${token}`);

    const items = res.body.data.grupos[0].items;
    // Dos ingresos = dos lotes, cada uno con SU costo.
    expect(items.length).toBe(2);
    const costos = items.map((i) => i.costoUnitarioActual).sort((a, b) => a - b);
    expect(costos).toEqual([50, 80]);
  });

  test("la salida descuenta del lote elegido y usa su costo", async () => {
    await crearItem();

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 5, monto: 250, costoUnitarioActual: 50, destino: "ALMACEN" });

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 5, monto: 400, costoUnitarioActual: 80, destino: "ALMACEN" });

    const lotes = await BatchModel.find({ itemId }).sort({ costoUnitario: 1 }).lean();
    const loteBarato = lotes[0]; // 50
    const loteCaro = lotes[1]; // 80

    const res = await request(app)
      .post("/api/v1/almacen/stock/salida")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, batchId: String(loteCaro._id), cantidad: 2, destino: "ALMACEN" });

    expect(res.status).toBe(201);
    // El movimiento de salida usa el costo del lote elegido.
    const salida = await MovementModel.findOne({ tipo: "SALIDA" }).lean();
    expect(salida.costoUnitario).toBe(80);
    expect(salida.monto).toBe(160);

    // Solo se descuenta el lote elegido.
    const loteCaroFinal = await BatchModel.findById(loteCaro._id).lean();
    const loteBaratoFinal = await BatchModel.findById(loteBarato._id).lean();
    expect(loteCaroFinal.cantidadDisponible).toBe(3);
    expect(loteBaratoFinal.cantidadDisponible).toBe(5);
  });

  test("rechaza salida sin lote indicado", async () => {
    await crearItem();

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 5, monto: 250, costoUnitarioActual: 50, destino: "ALMACEN" });

    const res = await request(app)
      .post("/api/v1/almacen/stock/salida")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 1, destino: "ALMACEN" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/lote/i);
  });

  test("rechaza salida que excede el saldo del lote", async () => {
    await crearItem();

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 2, monto: 100, costoUnitarioActual: 50, destino: "ALMACEN" });

    const lote = await BatchModel.findOne({ itemId }).lean();

    const res = await request(app)
      .post("/api/v1/almacen/stock/salida")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, batchId: String(lote._id), cantidad: 5, destino: "ALMACEN" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insuficiente/i);

    // El lote conserva su saldo.
    const loteFinal = await BatchModel.findById(lote._id).lean();
    expect(loteFinal.cantidadDisponible).toBe(2);
  });

  test("los lotes de un material se consultan con su saldo disponible", async () => {
    await crearItem();

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 150, costoUnitarioActual: 50, destino: "ALMACEN" });

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 1, monto: 80, costoUnitarioActual: 80, destino: "ALMACEN" });

    const res = await request(app)
      .get("/api/v1/almacen/lotes")
      .set("Authorization", `Bearer ${token}`)
      .query({ itemId, soloDisponibles: "true" });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].cantidadDisponible).toBeDefined();
    expect(res.body.data[0].costoUnitario).toBeDefined();
  });

  test("el ingreso registra su lote asociado al movimiento", async () => {
    await crearItem();

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 7, monto: 350, costoUnitarioActual: 50, destino: "ALMACEN" });

    const lote = await BatchModel.findOne({ itemId }).lean();
    expect(lote.cantidad).toBe(7);
    expect(lote.cantidadDisponible).toBe(7);
    expect(lote.costoUnitario).toBe(50);
    expect(lote.movementId).toBeTruthy();
  });

  test("el stock se filtra por categoría, código, nombre y tipo", async () => {
    const crear = async (nombre, categoria, tipo, codigo) => {
      const res = await request(app)
        .post("/api/v1/almacen/items")
        .set("Authorization", `Bearer ${token}`)
        .send({ nombre, categoria, tipo, codigo });
      await request(app)
        .post("/api/v1/almacen/stock/ingreso")
        .set("Authorization", `Bearer ${token}`)
        .send({ itemId: res.body.data._id, cantidad: 2, monto: 20, costoUnitarioActual: 10, destino: "ALMACEN" });
      return res.body.data;
    };

    await crear("Cable Filtro", "Cables", "Componente", "MAT-8001");
    await crear("Taladro Filtro", "Herramientas", "Herramienta", "MAT-8002");

    const buscarStock = async (query) => {
      const res = await request(app)
        .get("/api/v1/almacen/stock")
        .set("Authorization", `Bearer ${token}`)
        .query(query);
      return res.body.data.grupos.flatMap((g) => g.items);
    };

    const porCategoria = await buscarStock({ categoria: "Cables" });
    expect(porCategoria.length).toBe(1);
    expect(porCategoria[0].nombre).toBe("Cable Filtro");

    const porCodigo = await buscarStock({ codigo: "MAT-8002" });
    expect(porCodigo.length).toBe(1);
    expect(porCodigo[0].nombre).toBe("Taladro Filtro");

    const porNombre = await buscarStock({ nombre: "cable" });
    expect(porNombre.length).toBe(1);

    const porTipo = await buscarStock({ tipo: "Herramienta" });
    expect(porTipo.length).toBe(1);
    expect(porTipo[0].nombre).toBe("Taladro Filtro");
  });

  test("registra ingreso sin actualizar el costo base si el costo es 0", async () => {
    await crearItem();

    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 1, monto: 0, costoUnitarioActual: 0, destino: "ALMACEN" });

    const item = await ItemModel.findById(itemId).lean();
    expect(item.costoUnitario).toBe(50); // valor original del item
  });

  test("registra salida y descuenta stock", async () => {
    await crearItem();
    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 10, monto: 500, costoUnitarioActual: 50, destino: "ALMACEN" });

    const lote = await BatchModel.findOne({ itemId }).lean();

    const res = await request(app)
      .post("/api/v1/almacen/stock/salida")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, batchId: String(lote._id), cantidad: 4, destino: "ALMACEN" });

    expect(res.status).toBe(201);
    expect(res.body.data.cantidad).toBe(6);
  });

  test("rechaza salida con stock insuficiente", async () => {
    await crearItem();
    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 2, monto: 100, costoUnitarioActual: 50, destino: "ALMACEN" });

    // Stock total: 2 unidades en un único lote. Se pide más de lo disponible
    // usando un lote ajeno al material para llegar a la validación de stock.
    const lote = await BatchModel.findOne({ itemId }).lean();

    const res = await request(app)
      .post("/api/v1/almacen/stock/salida")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, batchId: String(lote._id), cantidad: 5, destino: "ALMACEN" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insuficiente/);
  });

  test("rechaza ingreso con item inexistente (404)", async () => {
    const id = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId: id, cantidad: 1, monto: 10, costoUnitarioActual: 10, destino: "ALMACEN" });

    expect(res.status).toBe(404);
  });
});

describe("Kardex y Dashboard", () => {
  test("kardex lista movimientos de un item", async () => {
    const item = await ItemModel.create({ nombre: "Kardex Item", categoria: "General", tipo: "Componente" });
    await StockModel.create({ itemId: item._id });
    await MovementModel.create({ tipo: "INGRESO", itemId: item._id, cantidad: 3, costoUnitario: 10, monto: 30, destino: "ALMACEN", destinoRef: "ALMACEN" });

    const res = await request(app)
      .get(`/api/v1/almacen/kardex/${item._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.rows.length).toBe(1);
    expect(res.body.data.rows[0].tipo).toBe("INGRESO");
  });

  test("dashboard devuelve indicadores", async () => {
    const item = await ItemModel.create({ nombre: "Item Dash", categoria: "General", tipo: "Componente", stockSeguridad: 5 });
    await StockModel.create({ itemId: item._id, cantidad: 2, montoTotalIngreso: 100 });

    const res = await request(app)
      .get("/api/v1/almacen/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalItems).toBe(1);
    expect(res.body.data.itemsBajoSeguridad).toBe(1); // 2 < 5
  });
});

describe("Integración Almacén ↔ Comercial (destino PEP)", () => {
  const PEP = "J.2026.999/001";
  const ELEMENTO = `${PEP}.01`;

  const crearItemConStock = async () => {
    const itemRes = await request(app)
      .post("/api/v1/almacen/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Item PEP", categoria: "General", tipo: "Componente", costoUnitario: 20 });
    const itemId = itemRes.body.data._id;

    // Stock inicial para poder registrar salidas
    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 5, monto: 100, costoUnitarioActual: 20, destino: "ALMACEN" });

    return itemId;
  };

  /** Crea el proyecto adjudicado y su elemento PEP habilitado (Carga = Si). */
  const crearPepConElemento = async (pep = PEP, elemento = ELEMENTO) => {
    await ComercialModel.create({
      Cliente: "Cliente A",
      Especialidad: "Ingeniería",
      Descripcion: "Proyecto adjudicado",
      PEP: pep,
      Estado: "Adjudicado",
      CBSLoad: "No",
      Moneda: "PEN",
    });

    await ComercialCBSModel.create({
      PEP: pep,
      ElementoPEP: elemento,
      Nivel: "2",
      Carga: "Si",
      Descripcion: "Elemento habilitado",
      Moneda: "PEN",
    });
  };

  test("permite ingreso con PEP adjudicado y elemento PEP habilitado", async () => {
    const itemId = await crearItemConStock();
    await crearPepConElemento();

    const res = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 60, costoUnitarioActual: 20, destino: "PEP", destinoRef: PEP, elementoPEP: ELEMENTO });

    expect(res.status).toBe(201);
    const mov = await MovementModel.findOne({ destino: "PEP" });
    expect(mov.destinoRef).toBe(PEP);
    expect(mov.elementoPEP).toBe(ELEMENTO);
  });

  test("rechaza destino PEP sin elemento PEP", async () => {
    const itemId = await crearItemConStock();
    await crearPepConElemento();

    const res = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 60, costoUnitarioActual: 20, destino: "PEP", destinoRef: PEP });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/elemento PEP/i);
  });

  test("rechaza elemento PEP no habilitado (Carga = No)", async () => {
    const itemId = await crearItemConStock();
    await crearPepConElemento(PEP, ELEMENTO);
    await ComercialCBSModel.create({
      PEP,
      ElementoPEP: `${PEP}.02`,
      Nivel: "2",
      Carga: "No",
      Descripcion: "Elemento deshabilitado",
      Moneda: "PEN",
    });

    const res = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 60, costoUnitarioActual: 20, destino: "PEP", destinoRef: PEP, elementoPEP: `${PEP}.02` });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no está habilitado/i);
  });

  test("rechaza elemento PEP que pertenece a otro PEP", async () => {
    const itemId = await crearItemConStock();
    await crearPepConElemento();
    await crearPepConElemento("J.2026.111/001", "J.2026.111/001.01");

    const res = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 60, costoUnitarioActual: 20, destino: "PEP", destinoRef: PEP, elementoPEP: "J.2026.111/001.01" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no está habilitado para el PEP/i);
  });

  test("rechaza ingreso con PEP no adjudicado o inexistente", async () => {
    const itemId = await crearItemConStock();

    const res = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 60, costoUnitarioActual: 20, destino: "PEP", destinoRef: "J.2026.000/999", elementoPEP: "J.2026.000/999.01" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no está adjudicado|no existe/i);
  });

  test("rechaza ingreso con PEP de proyecto NO adjudicado (ej. En Elaboración)", async () => {
    const itemId = await crearItemConStock();
    await ComercialModel.create({
      Cliente: "Cliente B",
      Especialidad: "Ingeniería",
      Descripcion: "En elaboración",
      PEP: "J.2026.888/001",
      Estado: "En Elaboración",
      CBSLoad: "No",
      Moneda: "PEN",
    });

    const res = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 60, costoUnitarioActual: 20, destino: "PEP", destinoRef: "J.2026.888/001", elementoPEP: "J.2026.888/001.01" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no está adjudicado|no existe/i);
  });

  test("registro de salida múltiple valida PEP y elemento PEP por item", async () => {
    const itemId = await crearItemConStock();
    await crearPepConElemento("J.2026.777/001", "J.2026.777/001.01");

    const lote = await BatchModel.findOne({ itemId }).lean();

    const res = await request(app)
      .post("/api/v1/almacen/stock/salidas/multiples")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [
          { itemId, batchId: String(lote._id), cantidad: 2, destino: "PEP", destinoRef: "J.2026.777/001", elementoPEP: "J.2026.777/001.01" },
          { itemId, batchId: String(lote._id), cantidad: 2, destino: "PEP", destinoRef: "J.2026.INEXISTENTE/001", elementoPEP: "J.2026.INEXISTENTE/001.01" },
        ],
      });

    expect(res.status).toBe(200);
    // 1 salida válida registrada y 1 error por PEP inválido
    expect(res.body.data.resultados.length).toBe(1);
    expect(res.body.data.errores.length).toBe(1);
    expect(res.body.data.errores[0].error).toMatch(/no está adjudicado|no existe/i);
  });

  test("la salida múltiple rechaza un item sin elemento PEP", async () => {
    const itemId = await crearItemConStock();
    await crearPepConElemento("J.2026.666/001", "J.2026.666/001.01");

    const lote = await BatchModel.findOne({ itemId }).lean();

    const res = await request(app)
      .post("/api/v1/almacen/stock/salidas/multiples")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [
          { itemId, batchId: String(lote._id), cantidad: 1, destino: "PEP", destinoRef: "J.2026.666/001" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.resultados.length).toBe(0);
    expect(res.body.data.errores.length).toBe(1);
    expect(res.body.data.errores[0].error).toMatch(/elemento PEP/i);
  });

  test("permite salida a PEP con elemento PEP habilitado", async () => {
    const itemId = await crearItemConStock();
    await crearPepConElemento("J.2026.555/001", "J.2026.555/001.01");

    const lote = await BatchModel.findOne({ itemId }).lean();

    const res = await request(app)
      .post("/api/v1/almacen/stock/salida")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, batchId: String(lote._id), cantidad: 2, destino: "PEP", destinoRef: "J.2026.555/001", elementoPEP: "J.2026.555/001.01" });

    expect(res.status).toBe(201);
    const mov = await MovementModel.findOne({ destino: "PEP" });
    expect(mov.elementoPEP).toBe("J.2026.555/001.01");
  });
});
