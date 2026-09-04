/**
 * Tests de integración HTTP (Supertest) del módulo Almacén.
 * Levanta una app Express mínima con las rutas reales del módulo,
 * usando mongodb-memory-server.
 *
 * Cubre:
 *  - Autenticación (401 sin token).
 *  - CRUD de categorías e items.
 *  - Ingreso/salida de stock y kardex.
 *  - Validaciones (duplicados, ObjectId, stock insuficiente).
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
const ComercialModel = require("../../models/comercial/comercial");

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
      .send({ nombre: "Interruptores", costoUnitario: 25 });

    expect(create.status).toBe(201);
    expect(create.body.data.nombre).toBe("Interruptores");

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

  test("rechaza item duplicado por nombre", async () => {
    const payload = { nombre: "Cable 14 AWG", categoria: "Cables", tipo: "Componente" };
    await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send(payload);
    const dup = await request(app).post("/api/v1/almacen/items").set("Authorization", `Bearer ${token}`).send(payload);

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

  test("actualizar item con id inválido devuelve 400", async () => {
    const res = await request(app)
      .put("/api/v1/almacen/items/id-invalido")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "X" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/inválido/);
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

  test("registra salida y descuenta stock", async () => {
    await crearItem();
    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 10, monto: 500, costoUnitarioActual: 50, destino: "ALMACEN" });

    const res = await request(app)
      .post("/api/v1/almacen/stock/salida")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 4, destino: "ALMACEN" });

    expect(res.status).toBe(201);
    expect(res.body.data.cantidad).toBe(6);
  });

  test("rechaza salida con stock insuficiente", async () => {
    await crearItem();
    await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 2, monto: 100, costoUnitarioActual: 50, destino: "ALMACEN" });

    const res = await request(app)
      .post("/api/v1/almacen/stock/salida")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 5, destino: "ALMACEN" });

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

  test("permite ingreso con PEP adjudicado en Comercial", async () => {
    const itemId = await crearItemConStock();
    await ComercialModel.create({
      Cliente: "Cliente A",
      Especialidad: "Ingeniería",
      Descripcion: "Proyecto",
      PEP: "J.2026.999/001",
      Estado: "Adjudicado",
      CBSLoad: "No",
      Moneda: "PEN",
    });

    const res = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 60, costoUnitarioActual: 20, destino: "PEP", destinoRef: "J.2026.999/001" });

    expect(res.status).toBe(201);
    const mov = await MovementModel.findOne({ destino: "PEP" });
    expect(mov.destinoRef).toBe("J.2026.999/001");
  });

  test("rechaza ingreso con PEP no adjudicado o inexistente", async () => {
    const itemId = await crearItemConStock();

    const res = await request(app)
      .post("/api/v1/almacen/stock/ingreso")
      .set("Authorization", `Bearer ${token}`)
      .send({ itemId, cantidad: 3, monto: 60, costoUnitarioActual: 20, destino: "PEP", destinoRef: "J.2026.000/999" });

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
      .send({ itemId, cantidad: 3, monto: 60, costoUnitarioActual: 20, destino: "PEP", destinoRef: "J.2026.888/001" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no está adjudicado|no existe/i);
  });

  test("registro de salida múltiple valida PEP por item", async () => {
    const itemId = await crearItemConStock();
    await ComercialModel.create({
      Cliente: "Cliente C",
      Especialidad: "Ingeniería",
      Descripcion: "Adjudicado 2",
      PEP: "J.2026.777/001",
      Estado: "Adjudicado",
      CBSLoad: "No",
      Moneda: "PEN",
    });

    const res = await request(app)
      .post("/api/v1/almacen/stock/salidas/multiples")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [
          { itemId, cantidad: 2, destino: "PEP", destinoRef: "J.2026.777/001" },
          { itemId, cantidad: 2, destino: "PEP", destinoRef: "J.2026.INEXISTENTE/001" },
        ],
      });

    expect(res.status).toBe(200);
    // 1 salida válida registrada y 1 error por PEP inválido
    expect(res.body.data.resultados.length).toBe(1);
    expect(res.body.data.errores.length).toBe(1);
    expect(res.body.data.errores[0].error).toMatch(/no está adjudicado|no existe/i);
  });
});
