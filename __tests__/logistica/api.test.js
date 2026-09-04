/**
 * Tests de integración HTTP (Supertest) del módulo Logística.
 * Levanta una app Express mínima con las rutas reales del módulo,
 * usando mongodb-memory-server.
 *
 * Cubre:
 *  - Autenticación (401 sin token, 200 con token).
 *  - Autorización de aprobadores vía colección User (tabla users).
 *  - Flujo SOLPED (crear borrador, enviar a aprobación, listar, aprobar).
 *  - Interacción con el módulo Comercial (PEPs adjudicados y elementos CBS).
 */
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { connect, disconnect, clearDatabase } = require("../helpers/mongo");
const logisticaRoutes = require("../../routes/v1/logistica/route");
const ComercialModel = require("../../models/comercial/comercial");
const ComercialCBSModel = require("../../models/comercial/comercial_CBS");
const UserModel = require("../../models/seguridad/user");

const TEST_SECRET = "test-jwt-secret-logistica-2026";
const APPROVER_EMAIL = "aprobador@jovalco.com";
const SOLICITANTE_EMAIL = "solicitante@jovalco.com";
const OTRA_PERSONA_EMAIL = "otra@jovalco.com";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", logisticaRoutes);
  return app;
};

const firmarToken = (email = APPROVER_EMAIL) =>
  jwt.sign(
    { sub: "u1", email, name: "Usuario", role: "admin" },
    TEST_SECRET,
    { expiresIn: "1h", algorithm: "HS256" },
  );

let app;
let tokenAprobador;
let tokenSolicitante;
let tokenOtraPersona;

const seedUsers = async () => {
  // Los aprobadores se definen en la colección User (no en variable de entorno).
  await UserModel.create([
    {
      email: APPROVER_EMAIL,
      nombre: "Aprobador",
      activo: true,
      logistica: { esAprobador: true },
    },
    {
      email: SOLICITANTE_EMAIL,
      nombre: "Solicitante",
      activo: true,
      logistica: { esAprobador: false },
    },
    {
      email: OTRA_PERSONA_EMAIL,
      nombre: "Otra Persona",
      activo: true,
      logistica: { esAprobador: false },
    },
  ]);
};

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = TEST_SECRET;
  await connect();
  app = createApp();
  tokenAprobador = firmarToken(APPROVER_EMAIL);
  tokenSolicitante = firmarToken(SOLICITANTE_EMAIL);
  tokenOtraPersona = firmarToken(OTRA_PERSONA_EMAIL);
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

/** Crea una propuesta adjudicada con un elemento CBS habilitado (Carga=Si). */
const seedComercialAdjudicado = async () => {
  const pep = "J.2026.001/001";
  await ComercialModel.create({
    Cliente: "Cliente A",
    Especialidad: "Ingeniería",
    Descripcion: "Proyecto adjudicado",
    PEP: pep,
    Estado: "Adjudicado",
    CBSLoad: "Si",
    Moneda: "PEN",
    Monto: 5000,
  });

  await ComercialCBSModel.create([
    {
      PEP: pep,
      ElementoPEP: `${pep}.01`,
      Nivel: "2",
      Carga: "Si",
      Descripcion: "Elemento habilitado",
      Venta: 1000,
      Porcentaje_venta: 1,
      Costo: 600,
      Porcentaje_costo: 1,
      Moneda: "PEN",
    },
    {
      PEP: pep,
      ElementoPEP: `${pep}.02`,
      Nivel: "2",
      Carga: "No",
      Descripcion: "Elemento deshabilitado",
      Venta: 500,
      Porcentaje_venta: 0.5,
      Costo: 300,
      Porcentaje_costo: 0.5,
      Moneda: "PEN",
    },
  ]);

  return pep;
};

const payloadSolpedValido = (pep, overrides = {}) => ({
  requesterEmail: SOLICITANTE_EMAIL,
  requesterName: "Juan Solicitante",
  accountingClass: "ADMIN_EXPENSE",
  accountingCategory: "Asesorias",
  accountingSubcategory: "",
  costCenter: "General",
  loanComponent: "NONE",
  observaciones: "Prueba",
  items: [
    {
      posicion: 10,
      pep,
      elementoPEP: `${pep}.01`,
      material: "MAT-001",
      descripcion: "Servicio de asesoría",
      cantidad: 2,
      unidad: "UN",
      precioEstimado: 100,
    },
  ],
  ...overrides,
});

describe("Autenticación Logística", () => {
  test("rechaza sin token con 401", async () => {
    const res = await request(app).get("/api/v1/logistica/solped");
    expect(res.status).toBe(401);
  });

  test("rechaza token inválido con 401", async () => {
    const res = await request(app)
      .get("/api/v1/logistica/solped")
      .set("Authorization", "Bearer invalido");
    expect(res.status).toBe(401);
  });

  test("permite OPTIONS sin token", async () => {
    const res = await request(app).options("/api/v1/logistica/solped");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/v1/logistica/pep-options", () => {
  test("devuelve solo PEPs adjudicados con elementos habilitados", async () => {
    const pep = await seedComercialAdjudicado();

    const res = await request(app)
      .get("/api/v1/logistica/pep-options")
      .set("Authorization", `Bearer ${tokenAprobador}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.length).toBeGreaterThanOrEqual(1);
    const pepEntry = data.find((item) => item.pep === pep);
    expect(pepEntry).toBeTruthy();

    // Solo el elemento con Carga=Si debe aparecer
    const elementos = pepEntry.elementos.map((e) => e.elementoPEP);
    expect(elementos).toContain(`${pep}.01`);
    expect(elementos).not.toContain(`${pep}.02`);
  });

  test("devuelve lista vacía si no hay PEPs adjudicados", async () => {
    const res = await request(app)
      .get("/api/v1/logistica/pep-options")
      .set("Authorization", `Bearer ${tokenAprobador}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe("POST /api/v1/logistica/solped", () => {
  test("crea SOLPED como borrador", async () => {
    const pep = await seedComercialAdjudicado();

    const res = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .send(payloadSolpedValido(pep, { submit: false }));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("Borrador");
    expect(res.body.data.solpedNumber).toMatch(/^SOLPED-\d{4}-\d{4}$/);
    // precio 100 sin IGV × 2 = base 200; con IGV 18% → total 236.
    expect(res.body.data.totalBase).toBe(200);
    expect(res.body.data.totalIGV).toBe(36);
    expect(res.body.data.totalEstimado).toBe(236);
    expect(res.body.data.moneda).toBe("PEN");
  });

  test("crea SOLPED enviada a aprobación cuando submit=true", async () => {
    const pep = await seedComercialAdjudicado();

    const res = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .send(payloadSolpedValido(pep, { submit: true }));

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("Pendiente Aprobacion");
  });

  test("rechaza item con elemento PEP deshabilitado", async () => {
    const pep = await seedComercialAdjudicado();

    const payload = payloadSolpedValido(pep);
    payload.items[0].elementoPEP = `${pep}.02`; // Carga = No

    const res = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no habilitado/i);
  });

  test("rechaza sin items con 400", async () => {
    const res = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .send({ requesterEmail: SOLICITANTE_EMAIL, items: [] });

    expect(res.status).toBe(400);
  });

  test("rechaza clasificación contable inválida", async () => {
    const pep = await seedComercialAdjudicado();

    const res = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .send(payloadSolpedValido(pep, { accountingClass: "INEXISTENTE" }));

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/logistica/solped (Mis SOLPED)", () => {
  test("un solicitante solo ve sus propias SOLPED", async () => {
    const pep = await seedComercialAdjudicado();

    // Crear una propia y una de otra persona (cada una con su token).
    await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .send(payloadSolpedValido(pep, { submit: false }));

    await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenOtraPersona}`)
      .send(payloadSolpedValido(pep, { submit: false }));

    const res = await request(app)
      .get("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .query({ mine: true });

    expect(res.status).toBe(200);
    const emails = res.body.data.map((row) => row.requesterEmail);
    expect(emails).toContain(SOLICITANTE_EMAIL);
    expect(emails).not.toContain(OTRA_PERSONA_EMAIL);
  });
});

describe("Aprobación de SOLPED", () => {
  test("un no-aprobador no puede ver la cola de aprobación", async () => {
    const res = await request(app)
      .get("/api/v1/logistica/approvals")
      .set("Authorization", `Bearer ${tokenSolicitante}`);

    expect(res.status).toBe(403);
  });

  test("un aprobador aprueba una SOLPED pendiente", async () => {
    const pep = await seedComercialAdjudicado();

    const creada = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .send(payloadSolpedValido(pep, { submit: true }));

    const id = creada.body.data._id;

    const res = await request(app)
      .patch(`/api/v1/logistica/approvals/${id}`)
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .set("x-user-email", APPROVER_EMAIL)
      .send({ action: "approve", comment: "OK" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Aprobado");
    expect(res.body.data.approvedBy).toBe(APPROVER_EMAIL);
  });

  test("un no-aprobador no puede aprobar (403)", async () => {
    const pep = await seedComercialAdjudicado();
    const creada = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .send(payloadSolpedValido(pep, { submit: true }));

    const id = creada.body.data._id;

    const res = await request(app)
      .patch(`/api/v1/logistica/approvals/${id}`)
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .send({ action: "approve" });

    expect(res.status).toBe(403);
  });

  test("el email del token manda sobre el header x-user-email (anti-spoofing)", async () => {
    const pep = await seedComercialAdjudicado();

    const creada = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .send(payloadSolpedValido(pep, { submit: true }));

    const id = creada.body.data._id;

    // El token es de un aprobador, pero el header intenta suplantar a un
    // no-aprobador. La autorización debe usar el email del token (aprobador).
    const res = await request(app)
      .patch(`/api/v1/logistica/approvals/${id}`)
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .set("x-user-email", SOLICITANTE_EMAIL)
      .send({ action: "approve" });

    expect(res.status).toBe(200);
    expect(res.body.data.approvedBy).toBe(APPROVER_EMAIL);
  });

  test("un no-aprobador no puede aprobar aunque envie header de aprobador", async () => {
    const pep = await seedComercialAdjudicado();
    const creada = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .send(payloadSolpedValido(pep, { submit: true }));

    const id = creada.body.data._id;

    // El token es de un no-aprobador; el header de aprobador no debe bastar.
    const res = await request(app)
      .patch(`/api/v1/logistica/approvals/${id}`)
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .set("x-user-email", APPROVER_EMAIL)
      .send({ action: "approve" });

    expect(res.status).toBe(403);
  });

  test("no se puede editar una SOLPED aprobada", async () => {
    const pep = await seedComercialAdjudicado();

    const creada = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .send(payloadSolpedValido(pep, { submit: true }));

    const id = creada.body.data._id;

    await request(app)
      .patch(`/api/v1/logistica/approvals/${id}`)
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .set("x-user-email", APPROVER_EMAIL)
      .send({ action: "approve" });

    const res = await request(app)
      .put(`/api/v1/logistica/solped/${id}`)
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .set("x-user-email", APPROVER_EMAIL)
      .send(payloadSolpedValido(pep, { submit: false }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/aprobada/);
  });
});

describe("GET /api/v1/logistica/dashboard", () => {
  test("el aprobador ve el dashboard agregado", async () => {
    const pep = await seedComercialAdjudicado();

    await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .send(payloadSolpedValido(pep, { submit: true }));

    const res = await request(app)
      .get("/api/v1/logistica/dashboard")
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .set("x-user-email", APPROVER_EMAIL);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.statusBuckets["Pendiente Aprobacion"]).toBe(1);
  });
});

describe("Moneda e IGV en SOLPED", () => {
  test("permite SOLPED en USD y propaga moneda", async () => {
    const pep = await seedComercialAdjudicado();

    const res = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .send(payloadSolpedValido(pep, { submit: false, moneda: "USD" }));

    expect(res.status).toBe(201);
    expect(res.body.data.moneda).toBe("USD");
    expect(res.body.data.totalEstimado).toBe(236); // base 200 + IGV 36 en USD
  });

  test("rechaza moneda no válida", async () => {
    const pep = await seedComercialAdjudicado();

    const res = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .send(payloadSolpedValido(pep, { submit: false, moneda: "EUR" }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Moneda debe ser PEN o USD/);
  });

  test("si el precio incluye IGV, no se agrega IGV extra (total = bruto)", async () => {
    const pep = await seedComercialAdjudicado();

    const payload = payloadSolpedValido(pep, { submit: false });
    // precio 100 YA incluye IGV → base = 200/1.18 = 169.49, IGV = 30.51
    payload.items[0].incluyeIGV = true;

    const res = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenSolicitante}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.totalEstimado).toBe(200); // el total a pagar es el bruto
    expect(res.body.data.totalBase).toBeCloseTo(169.49, 1);
    expect(res.body.data.totalIGV).toBeCloseTo(30.51, 1);
  });

  test("persiste moneda e IGV al pasar por aprobación (coherencia)", async () => {
    const pep = await seedComercialAdjudicado();

    const creada = await request(app)
      .post("/api/v1/logistica/solped")
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .send(payloadSolpedValido(pep, { submit: true, moneda: "USD" }));

    const id = creada.body.data._id;

    const aprobada = await request(app)
      .patch(`/api/v1/logistica/approvals/${id}`)
      .set("Authorization", `Bearer ${tokenAprobador}`)
      .set("x-user-email", APPROVER_EMAIL)
      .send({ action: "approve" });

    expect(aprobada.status).toBe(200);
    expect(aprobada.body.data.moneda).toBe("USD");
    expect(aprobada.body.data.totalEstimado).toBe(236);
    expect(aprobada.body.data.status).toBe("Aprobado");
  });
});
