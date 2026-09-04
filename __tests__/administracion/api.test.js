/**
 * Tests de integración HTTP (Supertest) del módulo Administración.
 * Levanta una app Express mínima con las rutas reales del módulo,
 * usando mongodb-memory-server.
 *
 * Cubre:
 *  - Autenticación (401 sin token).
 *  - CRUD de personal (crear, listar, obtener, actualizar, eliminar soft).
 *  - Validaciones: DNI obligatorio/formato, DNI duplicado, id inválido.
 *  - Coherencia con Seguridad: al eliminar personal con ficha de seguridad,
 *    se informa warning.
 */
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { connect, disconnect, clearDatabase } = require("../helpers/mongo");
const adminRoutes = require("../../routes/v1/administracion/route");
const PersonalModel = require("../../models/administracion/personal");
const PersonalHistoryModel = require("../../models/administracion/personal_history");
const SeguridadPersonalModel = require("../../models/seguridad/personal");

const TEST_SECRET = "test-jwt-secret-admin-2026";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", adminRoutes);
  return app;
};

const firmarToken = (email = "admin@jovalco.com") =>
  jwt.sign(
    { sub: "u1", email, name: "Admin", role: "admin" },
    TEST_SECRET,
    { expiresIn: "1h", algorithm: "HS256" },
  );

let app;
let token;

const payloadPersonalValido = (overrides = {}) => ({
  data: {
    nombres: "Juan",
    apellidos: "Perez",
    dni: "12345678",
    cargo: "Ingeniero",
    area: "Proyectos",
    estado: "Activo",
    ...overrides,
  },
});

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

describe("Autenticación Administración", () => {
  test("rechaza sin token con 401", async () => {
    const res = await request(app).get("/api/v1/administracion/getpersonal");
    expect(res.status).toBe(401);
  });

  test("rechaza token inválido con 401", async () => {
    const res = await request(app)
      .get("/api/v1/administracion/getpersonal")
      .set("Authorization", "Bearer invalido");
    expect(res.status).toBe(401);
  });

  test("permite OPTIONS sin token", async () => {
    const res = await request(app).options("/api/v1/administracion/getpersonal");
    expect(res.status).toBe(200);
  });
});

describe("CRUD Personal", () => {
  test("crea y lista personal", async () => {
    const create = await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido());

    expect(create.status).toBe(201);
    expect(create.body.data.dni).toBe("12345678");

    const list = await request(app)
      .get("/api/v1/administracion/getpersonal")
      .set("Authorization", `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(1);
  });

  test("rechaza DNI obligatorio", async () => {
    const res = await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido({ dni: "" }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/DNI es obligatorio/);
  });

  test("rechaza DNI con formato inválido", async () => {
    const res = await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido({ dni: "123" }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8 dígitos/);
  });

  test("rechaza DNI duplicado", async () => {
    await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido());

    const dup = await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido({ nombres: "Otro" }));

    expect(dup.status).toBe(400);
    expect(dup.body.message).toMatch(/ya existe/i);
  });

  test("obtiene personal por id y por id inválido devuelve 400", async () => {
    const creado = await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido());

    const id = creado.body.data._id;

    const ok = await request(app)
      .get(`/api/v1/administracion/getpersonal/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.dni).toBe("12345678");

    const bad = await request(app)
      .get("/api/v1/administracion/getpersonal/id-invalido")
      .set("Authorization", `Bearer ${token}`);
    expect(bad.status).toBe(400);
  });

  test("actualiza personal y guarda historial", async () => {
    const creado = await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido());

    const id = creado.body.data._id;

    const update = await request(app)
      .put(`/api/v1/administracion/updatepersonal/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido({ cargo: "Ingeniero Senior" }));

    expect(update.status).toBe(200);
    expect(update.body.data.cargo).toBe("Ingeniero Senior");

    const history = await PersonalHistoryModel.countDocuments({ personalId: id });
    expect(history).toBe(1);
  });

  test("rechaza cambiar DNI a uno existente", async () => {
    await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido({ dni: "11111111" }));

    const creado = await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido({ dni: "22222222" }));

    const id = creado.body.data._id;

    const res = await request(app)
      .put(`/api/v1/administracion/updatepersonal/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido({ dni: "11111111" }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ya existe otro/i);
  });
});

describe("Eliminación y coherencia con Seguridad", () => {
  test("elimina personal (soft delete) y ya no aparece en listado", async () => {
    const creado = await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido());

    const id = creado.body.data._id;

    const del = await request(app)
      .delete(`/api/v1/administracion/deletepersonal/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const list = await request(app)
      .get("/api/v1/administracion/getpersonal")
      .set("Authorization", `Bearer ${token}`);
    expect(list.body.data.length).toBe(0);
  });

  test("advierte si el personal tiene ficha de seguridad", async () => {
    const creado = await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido());

    const id = creado.body.data._id;

    // Crear ficha de seguridad referenciando al personal (módulo Seguridad).
    await SeguridadPersonalModel.create({ personalId: id });

    const del = await request(app)
      .delete(`/api/v1/administracion/deletepersonal/${id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(del.status).toBe(200);
    expect(Array.isArray(del.body.warnings)).toBe(true);
    expect(del.body.warnings.length).toBe(1);
    expect(del.body.warnings[0]).toMatch(/ficha de seguridad/);
  });

  test("no genera warning si no tiene ficha de seguridad", async () => {
    const creado = await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido());

    const id = creado.body.data._id;

    const del = await request(app)
      .delete(`/api/v1/administracion/deletepersonal/${id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(del.status).toBe(200);
    expect(del.body.warnings).toEqual([]);
  });
});

describe("Estadísticas", () => {
  test("devuelve estadísticas de personal", async () => {
    await request(app)
      .post("/api/v1/administracion/createpersonal")
      .set("Authorization", `Bearer ${token}`)
      .send(payloadPersonalValido({ area: "Proyectos", cargo: "Ingeniero" }));

    const res = await request(app)
      .get("/api/v1/administracion/getestadisticas")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalPersonal).toBe(1);
    expect(res.body.data.personalPorArea.length).toBe(1);
  });
});
