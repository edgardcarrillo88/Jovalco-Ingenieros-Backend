/**
 * Tests de integración HTTP (Supertest) del módulo Seguridad.
 * Levanta una app Express mínima con las rutas reales del módulo,
 * usando mongodb-memory-server.
 *
 * Cubre:
 *  - Autenticación (401 sin token).
 *  - Coherencia con Administración: getFicha solo para personal existente.
 *  - Fichas (exámenes/certificaciones/capacitaciones/EPP).
 *  - Documentos, eventos y checklist.
 *  - Validación de ObjectId (400 en vez de 500).
 */
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { connect, disconnect, clearDatabase } = require("../helpers/mongo");
const seguridadRoutes = require("../../routes/v1/seguridad/route");
const PersonalModel = require("../../models/administracion/personal");
const SeguridadPersonalModel = require("../../models/seguridad/personal");
const SeguridadDocumentoModel = require("../../models/seguridad/documento");
const SeguridadEventoModel = require("../../models/seguridad/evento");

const TEST_SECRET = "test-jwt-secret-seguridad-2026";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", seguridadRoutes);
  return app;
};

const firmarToken = (email = "seguridad@jovalco.com") =>
  jwt.sign(
    { sub: "u1", email, name: "Seguridad", role: "admin" },
    TEST_SECRET,
    { expiresIn: "1h", algorithm: "HS256" },
  );

let app;
let token;

const crearPersonal = async (overrides = {}) => {
  const doc = await PersonalModel.create({
    nombres: "Juan",
    apellidos: "Perez",
    dni: "12345678",
    cargo: "Operario",
    area: "Obra",
    estado: "Activo",
    ...overrides,
  });
  return doc;
};

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

describe("Autenticación Seguridad", () => {
  test("rechaza sin token con 401", async () => {
    const res = await request(app).get("/api/v1/seguridad/dashboard");
    expect(res.status).toBe(401);
  });

  test("rechaza token inválido con 401", async () => {
    const res = await request(app)
      .get("/api/v1/seguridad/personal")
      .set("Authorization", "Bearer invalido");
    expect(res.status).toBe(401);
  });

  test("permite OPTIONS sin token", async () => {
    const res = await request(app).options("/api/v1/seguridad/dashboard");
    expect(res.status).toBe(200);
  });
});

describe("Coherencia Seguridad ↔ Administración (fichas)", () => {
  test("getFicha crea ficha solo para personal existente", async () => {
    const personal = await crearPersonal();

    const res = await request(app)
      .get(`/api/v1/seguridad/personal/${personal._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(String(res.body.data.personalId)).toBe(String(personal._id));
  });

  test("getFicha rechaza personal inexistente (404)", async () => {
    const id = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`/api/v1/seguridad/personal/${id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no encontrado en Administración/);
  });

  test("getFicha con id inválido devuelve 400", async () => {
    const res = await request(app)
      .get("/api/v1/seguridad/personal/id-invalido")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  test("getFicha rechaza personal eliminado (soft delete en Administración)", async () => {
    const personal = await crearPersonal({ deleted: true });

    const res = await request(app)
      .get(`/api/v1/seguridad/personal/${personal._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test("listFichas solo lista personal activo con sus conteos", async () => {
    const personal = await crearPersonal();
    const eliminado = await crearPersonal({ nombres: "Ana", dni: "87654321", deleted: true });
    await SeguridadPersonalModel.create({
      personalId: personal._id,
      examenesMedicos: [{ tipo: "Pre-ocupacional", fechaRealizacion: new Date(), fechaVencimiento: new Date("2027-01-01") }],
    });

    const res = await request(app)
      .get("/api/v1/seguridad/personal")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((r) => String(r._id));
    expect(ids).toContain(String(personal._id));
    expect(ids).not.toContain(String(eliminado._id));
    const fila = res.body.data.find((r) => String(r._id) === String(personal._id));
    expect(fila.examenesCount).toBe(1);
    expect(fila.tieneFicha).toBe(true);
  });
});

describe("Fichas: exámenes, certificaciones, capacitaciones, EPP", () => {
  const abrirFicha = async (personalId) => {
    // El flujo real abre la ficha primero (getFicha la crea).
    await request(app)
      .get(`/api/v1/seguridad/personal/${personalId}`)
      .set("Authorization", `Bearer ${token}`);
  };

  test("agrega examen a la ficha", async () => {
    const personal = await crearPersonal();
    await abrirFicha(personal._id);

    const res = await request(app)
      .post(`/api/v1/seguridad/personal/${personal._id}/examen`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tipo: "Pre-ocupacional", fechaRealizacion: "2026-01-10", fechaVencimiento: "2027-01-10" });

    expect(res.status).toBe(201);
    const ficha = await SeguridadPersonalModel.findOne({ personalId: personal._id });
    expect(ficha.examenesMedicos.length).toBe(1);
    expect(ficha.examenesMedicos[0].estado).toBe("Vigente");
  });

  test("agrega entrega EPP a la ficha", async () => {
    const personal = await crearPersonal();
    await abrirFicha(personal._id);

    const res = await request(app)
      .post(`/api/v1/seguridad/personal/${personal._id}/epp`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tipoEPP: "Casco", cantidad: 2 });

    expect(res.status).toBe(201);
    const ficha = await SeguridadPersonalModel.findOne({ personalId: personal._id });
    expect(ficha.entregasEPP.length).toBe(1);
    expect(ficha.entregasEPP[0].cantidad).toBe(2);
  });

  test("agrega examen a personal inexistente devuelve 404", async () => {
    const id = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/v1/seguridad/personal/${id}/examen`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tipo: "Pre-ocupacional", fechaRealizacion: "2026-01-10" });

    expect(res.status).toBe(404);
  });
});

describe("Documentos (catálogo maestro)", () => {
  test("crea y lista documentos", async () => {
    const create = await request(app)
      .post("/api/v1/seguridad/documentos")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "Carnet de altura", categoria: "Exámenes médicos" });

    expect(create.status).toBe(201);

    const list = await request(app)
      .get("/api/v1/seguridad/documentos")
      .set("Authorization", `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(1);
  });

  test("actualizar documento con id inválido devuelve 400", async () => {
    const res = await request(app)
      .patch("/api/v1/seguridad/documentos/id-invalido")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "X" });

    expect(res.status).toBe(400);
  });
});

describe("Eventos", () => {
  test("crea evento con código secuencial", async () => {
    const res = await request(app)
      .post("/api/v1/seguridad/eventos")
      .set("Authorization", `Bearer ${token}`)
      .send({ tipo: "Accidente", descripcion: "Caída", lugar: "Obra", criticidad: "Alta" });

    expect(res.status).toBe(201);
    expect(res.body.data.codigo).toBe("EVT-0001");
  });

  test("no permite cerrar evento con acciones pendientes", async () => {
    const creado = await request(app)
      .post("/api/v1/seguridad/eventos")
      .set("Authorization", `Bearer ${token}`)
      .send({ tipo: "Accidente", descripcion: "X", estado: "Abierto" });

    const id = creado.body.data._id;

    await SeguridadEventoModel.updateOne(
      { _id: id },
      { $push: { accionesCorrectivas: { accion: "Capacitar", estado: "Pendiente" } } },
    );

    const res = await request(app)
      .patch(`/api/v1/seguridad/eventos/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ estado: "Cerrado" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/acciones correctivas pendientes/);
  });

  test("actualizar evento con id inválido devuelve 400", async () => {
    const res = await request(app)
      .patch("/api/v1/seguridad/eventos/id-invalido")
      .set("Authorization", `Bearer ${token}`)
      .send({ estado: "Abierto" });

    expect(res.status).toBe(400);
  });
});
