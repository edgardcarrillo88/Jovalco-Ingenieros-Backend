/**
 * Tests de integración HTTP (Supertest) del módulo Equipo.
 * Levanta una app Express mínima con las rutas reales del módulo,
 * usando mongodb-memory-server.
 *
 * Cubre:
 *  - Autenticación (401 sin token).
 *  - Aprobadores vía colección User (tabla users), AUTH_BYPASS=false.
 *  - Anti-spoofing: el email del token manda sobre el header.
 *  - Flujo timesheet (crear, enviar a aprobación, aprobar).
 *  - Integración con Comercial (PEPs adjudicados para pep-options).
 */
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { connect, disconnect, clearDatabase } = require("../helpers/mongo");
const equipoRoutes = require("../../routes/v1/equipo/route");
const TimesheetModel = require("../../models/equipo/timesheet");
const ComercialModel = require("../../models/comercial/comercial");
const UserModel = require("../../models/seguridad/user");

const TEST_SECRET = "test-jwt-secret-equipo-2026";
const APROBADOR_EMAIL = "aprobador-equipo@jovalco.com";
const COLABORADOR_EMAIL = "colaborador@jovalco.com";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", equipoRoutes);
  return app;
};

const firmarToken = (email = APROBADOR_EMAIL) =>
  jwt.sign(
    { sub: "u1", email, name: "Usuario", role: "admin" },
    TEST_SECRET,
    { expiresIn: "1h", algorithm: "HS256" },
  );

let app;
let tokenAprobador;
let tokenColaborador;

const seedUsers = async () => {
  await UserModel.create([
    {
      email: APROBADOR_EMAIL,
      nombre: "Aprobador",
      activo: true,
      equipo: { esAprobador: true },
    },
    {
      email: COLABORADOR_EMAIL,
      nombre: "Colaborador",
      activo: true,
      equipo: { esAprobador: false },
    },
  ]);
};

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = TEST_SECRET;
  await connect();
  app = createApp();
  tokenAprobador = firmarToken(APROBADOR_EMAIL);
  tokenColaborador = firmarToken(COLABORADOR_EMAIL);
});

beforeEach(async () => {
  await seedUsers();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  delete process.env.AUTH_JWT_SECRET;
  await disconnect();
});

const payloadTimesheetValido = (overrides = {}) => ({
  requesterEmail: COLABORADOR_EMAIL,
  requesterName: "Colaborador Test",
  entries: [
    {
      hours: 8,
      description: "Trabajo en proyecto",
      pep: "J.2026.001/001",
      activityDate: "2026-08-10",
    },
  ],
  ...overrides,
});

describe("Autenticación Equipo", () => {
  test("rechaza sin token con 401", async () => {
    const res = await request(app).get("/api/v1/equipo/timesheets");
    expect(res.status).toBe(401);
  });

  test("rechaza token inválido con 401", async () => {
    const res = await request(app)
      .get("/api/v1/equipo/timesheets")
      .set("Authorization", "Bearer invalido");
    expect(res.status).toBe(401);
  });

  test("permite OPTIONS sin token", async () => {
    const res = await request(app).options("/api/v1/equipo/timesheets");
    expect(res.status).toBe(200);
  });
});

describe("Integración Equipo ↔ Comercial (pep-options)", () => {
  test("devuelve solo PEPs adjudicados", async () => {
    await ComercialModel.create([
      { PEP: "J.2026.001/001", Descripcion: "Adjudicado", Cliente: "A", Estado: "Adjudicado" },
      { PEP: "J.2026.002/001", Descripcion: "En elaboración", Cliente: "B", Estado: "En Elaboración" },
    ]);

    const res = await request(app)
      .get("/api/v1/equipo/pep-options")
      .set("Authorization", `Bearer ${tokenAprobador}`);

    expect(res.status).toBe(200);
    const peps = res.body.data.map((p) => p.pep);
    expect(peps).toContain("J.2026.001/001");
    expect(peps).not.toContain("J.2026.002/001");
  });
});

describe("Flujo de Timesheet", () => {
  test("crea timesheet como borrador", async () => {
    const res = await request(app)
      .post("/api/v1/equipo/timesheets")
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .send(payloadTimesheetValido());

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("Borrador");
    expect(res.body.data.totalHours).toBe(8);
  });

  test("crea timesheet enviado a aprobación con submit=true", async () => {
    const res = await request(app)
      .post("/api/v1/equipo/timesheets")
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .send(payloadTimesheetValido({ submit: true }));

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("Pendiente Aprobacion");
  });

  test("rechaza entrada sin PEP", async () => {
    const res = await request(app)
      .post("/api/v1/equipo/timesheets")
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .send(payloadTimesheetValido({ entries: [{ hours: 8, description: "X", pep: "", activityDate: "2026-08-10" }] }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/PEP/);
  });

  test("actualizar timesheet con id inválido devuelve 400", async () => {
    const res = await request(app)
      .put("/api/v1/equipo/timesheets/id-invalido")
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .send(payloadTimesheetValido());

    expect(res.status).toBe(400);
  });
});

describe("Aprobación de timesheets (tabla users)", () => {
  test("un aprobador ve la cola y aprueba", async () => {
    const creado = await request(app)
      .post("/api/v1/equipo/timesheets")
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .send(payloadTimesheetValido({ submit: true }));

    const id = creado.body.data._id;

    const queue = await request(app)
      .get("/api/v1/equipo/approvals")
      .set("Authorization", `Bearer ${tokenAprobador}`);
    expect(queue.status).toBe(200);
    expect(queue.body.data.length).toBe(1);

    const res = await request(app)
      .patch(`/api/v1/equipo/approvals/${id}`)
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .send({ action: "approve", comment: "OK" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Aprobado");
    expect(res.body.data.approvedBy).toBe(APROBADOR_EMAIL);
  });

  test("un no-aprobador no puede ver la cola (403)", async () => {
    const res = await request(app)
      .get("/api/v1/equipo/approvals")
      .set("Authorization", `Bearer ${tokenColaborador}`);

    expect(res.status).toBe(403);
  });

  test("un no-aprobador no puede aprobar aunque envie header de aprobador (anti-spoofing)", async () => {
    const creado = await request(app)
      .post("/api/v1/equipo/timesheets")
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .send(payloadTimesheetValido({ submit: true }));

    const id = creado.body.data._id;

    const res = await request(app)
      .patch(`/api/v1/equipo/approvals/${id}`)
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .set("x-user-email", APROBADOR_EMAIL)
      .send({ action: "approve" });

    expect(res.status).toBe(403);
  });

  test("el email del token manda sobre el header (anti-spoofing aprobador)", async () => {
    const creado = await request(app)
      .post("/api/v1/equipo/timesheets")
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .send(payloadTimesheetValido({ requesterEmail: APROBADOR_EMAIL, submit: true }));

    const id = creado.body.data._id;

    const res = await request(app)
      .patch(`/api/v1/equipo/approvals/${id}`)
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .set("x-user-email", COLABORADOR_EMAIL) // intento de suplantar a no-aprobador
      .send({ action: "approve" });

    expect(res.status).toBe(200); // el token es de aprobador → manda
    expect(res.body.data.approvedBy).toBe(APROBADOR_EMAIL);
  });

  test("no se puede editar un timesheet aprobado", async () => {
    const creado = await request(app)
      .post("/api/v1/equipo/timesheets")
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .send(payloadTimesheetValido({ submit: true }));

    const id = creado.body.data._id;

    await request(app)
      .patch(`/api/v1/equipo/approvals/${id}`)
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .send({ action: "approve" });

    const res = await request(app)
      .put(`/api/v1/equipo/timesheets/${id}`)
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .send(payloadTimesheetValido());

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/aprobado/);
  });
});

describe("Dashboard Equipo", () => {
  test("el aprobador ve métricas globales", async () => {
    await request(app)
      .post("/api/v1/equipo/timesheets")
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .send(payloadTimesheetValido({ submit: true }));

    const res = await request(app)
      .get("/api/v1/equipo/dashboard")
      .set("Authorization", `Bearer ${tokenAprobador}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalTimesheets).toBe(1);
    expect(res.body.data.totalHours).toBe(8);
  });

  test("un colaborador solo ve sus métricas", async () => {
    await request(app)
      .post("/api/v1/equipo/timesheets")
      .set("Authorization", `Bearer ${tokenColaborador}`)
      .send(payloadTimesheetValido({ submit: true }));

    const res = await request(app)
      .get("/api/v1/equipo/dashboard")
      .set("Authorization", `Bearer ${tokenColaborador}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalTimesheets).toBe(1); // ve solo los suyos
  });
});
