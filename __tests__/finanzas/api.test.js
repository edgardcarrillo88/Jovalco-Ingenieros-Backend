/**
 * Tests de integración HTTP (Supertest) del módulo Finanzas.
 * Levanta una app Express mínima con las rutas reales del módulo,
 * usando mongodb-memory-server.
 *
 * Cubre:
 *  - Autenticación en todas las rutas (401 sin token).
 *  - GET /finanzas/accounting/catalog (que consume Logística) protegido.
 *  - Endpoints de solo lectura (dashboard, recurrent, financial-statement).
 */
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { connect, disconnect, clearDatabase } = require("../helpers/mongo");
const finanzasRoutes = require("../../routes/v1/finanzas/route");
const ComercialModel = require("../../models/comercial/comercial");
const ProjectTrackingModel = require("../../models/proyectos/project_tracking");
const SolpedModel = require("../../models/logistica/solped");
const InvoiceModel = require("../../models/finanzas/invoice");
const RecurrentPayableModel = require("../../models/finanzas/recurrent_payable");
const UserModel = require("../../models/seguridad/user");

const TEST_SECRET = "test-jwt-secret-finanzas-2026";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", finanzasRoutes);
  return app;
};

const firmarToken = () =>
  jwt.sign(
    { sub: "u1", email: "fin@jovalco.com", name: "Finanzas", role: "admin" },
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
  // Usuario de finanzas en BD (para override contable).
  await UserModel.create({
    email: "fin@jovalco.com",
    nombre: "Finanzas",
    activo: true,
    finanzas: { rol: "finanzas" },
  });
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  delete process.env.AUTH_JWT_SECRET;
  await disconnect();
});

describe("Autenticación Finanzas", () => {
  test("rechaza sin token en el catálogo contable con 401", async () => {
    const res = await request(app).get("/api/v1/finanzas/accounting/catalog");
    expect(res.status).toBe(401);
  });

  test("rechaza sin token en dashboard con 401", async () => {
    const res = await request(app).get("/api/v1/finanzas/dashboard");
    expect(res.status).toBe(401);
  });

  test("rechaza token inválido con 401", async () => {
    const res = await request(app)
      .get("/api/v1/finanzas/accounting/catalog")
      .set("Authorization", "Bearer invalido");
    expect(res.status).toBe(401);
  });

  test("permite OPTIONS sin token", async () => {
    const res = await request(app).options("/api/v1/finanzas/accounting/catalog");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/v1/finanzas/accounting/catalog", () => {
  test("devuelve el catálogo contable con token válido", async () => {
    const res = await request(app)
      .get("/api/v1/finanzas/accounting/catalog")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(Array.isArray(data.classes)).toBe(true);
    expect(data.categoriesByClass).toBeTruthy();
    expect(Array.isArray(data.loanComponents)).toBe(true);
    expect(Array.isArray(data.costCenters)).toBe(true);
  });
});

describe("GET /api/v1/finanzas/recurrent", () => {
  test("devuelve lista (vacía) de recurrentes con token", async () => {
    const res = await request(app)
      .get("/api/v1/finanzas/recurrent")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/v1/finanzas/financial-statement", () => {
  test("devuelve el estado financiero con token", async () => {
    const res = await request(app)
      .get("/api/v1/finanzas/financial-statement")
      .set("Authorization", `Bearer ${token}`)
      .query({ year: new Date().getFullYear() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("GET /api/v1/finanzas/valuations/pending", () => {
  test("requiere token (401 sin él)", async () => {
    const res = await request(app).get("/api/v1/finanzas/valuations/pending");
    expect(res.status).toBe(401);
  });

  test("responde 200 con token (puede estar vacío)", async () => {
    const res = await request(app)
      .get("/api/v1/finanzas/valuations/pending")
      .set("Authorization", `Bearer ${token}`);

    // El endpoint puede devolver 200 aunque no haya valuaciones pendientes.
    expect([200, 404]).toContain(res.status);
  });
});

describe("Coherencia Finanzas ↔ Proyectos (factura desde valuación)", () => {
  const PEP = "J.2026.001/001";

  const seedProyectoConValuacion = async () => {
    await ComercialModel.create({
      Cliente: "Cliente A",
      Descripcion: "Proyecto",
      PEP,
      Estado: "Adjudicado",
      Moneda: "PEN",
      Monto: 10000,
    });

    await ProjectTrackingModel.create({
      pep: PEP,
      projectName: "Proyecto",
      client: "Cliente A",
      valuations: [
        {
          number: 1,
          valuationDate: new Date("2026-07-15"),
          totalValorizado: 5000,
          items: [],
        },
      ],
    });
  };

  test("genera factura desde una valuación pendiente de Proyectos", async () => {
    await seedProyectoConValuacion();
    const tracking = await ProjectTrackingModel.findOne({ pep: PEP });
    const valuationId = String(tracking.valuations[0]._id);

    const res = await request(app)
      .post("/api/v1/finanzas/invoices/from-valuation")
      .set("Authorization", `Bearer ${token}`)
      .send({ pep: PEP, valuationId, igvApplied: true });

    expect(res.status).toBe(201);
    expect(res.body.data.baseAmount).toBe(5000);
    expect(res.body.data.igvAmount).toBe(900); // 18% de 5000
    expect(res.body.data.amount).toBe(5900);

    // La valuación en Proyectos debe quedar marcada como facturada (coherencia).
    const updated = await ProjectTrackingModel.findOne({ pep: PEP });
    expect(updated.valuations[0].invoiceIssued).toBe(true);
    expect(updated.valuations[0].invoiceNumber).toBeTruthy();
  });

  test("rechaza facturar una valuación ya facturada", async () => {
    await seedProyectoConValuacion();
    const tracking = await ProjectTrackingModel.findOne({ pep: PEP });
    const valuationId = String(tracking.valuations[0]._id);

    // Primera factura OK
    await request(app)
      .post("/api/v1/finanzas/invoices/from-valuation")
      .set("Authorization", `Bearer ${token}`)
      .send({ pep: PEP, valuationId, igvApplied: false });

    // Segunda intento debe fallar (ya facturada)
    const res = await request(app)
      .post("/api/v1/finanzas/invoices/from-valuation")
      .set("Authorization", `Bearer ${token}`)
      .send({ pep: PEP, valuationId, igvApplied: false });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ya tiene factura/i);
  });

  test("lista valuaciones pendientes de facturar", async () => {
    await seedProyectoConValuacion();

    const res = await request(app)
      .get("/api/v1/finanzas/valuations/pending")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pendingValuations.length).toBe(1);
    expect(res.body.data.pendingValuations[0].pep).toBe(PEP);
  });
});

describe("Coherencia Finanzas ↔ Logística (pagos de SOLPED)", () => {
  const seedSolpedAprobada = async (overrides = {}) => {
    const solped = await SolpedModel.create({
      solpedNumber: "SOLPED-2026-0001",
      requesterEmail: "solicitante@correo.com",
      moneda: "USD",
      totalEstimado: 1180,
      totalBase: 1000,
      totalIGV: 180,
      status: "Aprobado",
      paymentStatus: "Pendiente",
      paidAmount: 0,
      // Clasificación contable que Logística exige al aprobar una SOLPED.
      accountingClass: "ADMIN_EXPENSE",
      accountingCategory: "Asesorias",
      accountingSubcategory: "",
      costCenter: "General",
      loanComponent: "NONE",
      items: [],
      ...overrides,
    });
    return String(solped._id);
  };

  test("marca SOLPED aprobada como pagada y registra historial", async () => {
    const id = await seedSolpedAprobada();

    const res = await request(app)
      .patch(`/api/v1/finanzas/payables/solped/${id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "Pagado", paymentReference: "REF-001" });

    expect(res.status).toBe(200);
    const updated = await SolpedModel.findById(id);
    expect(updated.paymentStatus).toBe("Pagado");
    expect(updated.paidAmount).toBe(1180);
    expect(updated.paymentHistory.length).toBe(1);
  });

  test("lista SOLPED aprobadas como cuentas por pagar con moneda y desglose IGV", async () => {
    await seedSolpedAprobada();

    const res = await request(app)
      .get("/api/v1/finanzas/payables")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.rows.length).toBe(1);
    const row = res.body.data.rows[0];
    expect(row.reference).toBe("SOLPED-2026-0001");
    // La moneda e IGV de la SOLPED se reflejan en las cuentas por pagar.
    expect(row.currency).toBe("USD");
    expect(row.amount).toBe(1180);
    expect(row.baseAmount).toBe(1000);
    expect(row.igvAmount).toBe(180);
  });
});

describe("Validación de IDs en Finanzas", () => {
  test("actualizar factura con id inválido devuelve 400 (no 500)", async () => {
    const res = await request(app)
      .patch("/api/v1/finanzas/invoices/id-invalido/status")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "Cobrado" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/inválido/i);
  });

  test("actualizar recurrente con id inválido devuelve 400 (no 500)", async () => {
    const res = await request(app)
      .patch("/api/v1/finanzas/recurrent/id-invalido/active")
      .set("Authorization", `Bearer ${token}`)
      .send({ isActive: true });

    expect(res.status).toBe(400);
  });

  test("eliminar recurrente con id inválido devuelve 400 (no 500)", async () => {
    const res = await request(app)
      .delete("/api/v1/finanzas/recurrent/id-invalido")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  test("pagar SOLPED con id inválido devuelve 400 (no 500)", async () => {
    const res = await request(app)
      .patch("/api/v1/finanzas/payables/solped/id-invalido/status")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "Pagado" });

    expect(res.status).toBe(400);
  });
});

describe("Dashboard de Finanzas separado por moneda", () => {
  test("openPayables separa PEN y USD", async () => {
    // SOLPED en USD aprobada por 1180 (base 1000 + IGV 180).
    await SolpedModel.create({
      solpedNumber: "SOLPED-2026-0100",
      requesterEmail: "a@correo.com",
      moneda: "USD",
      totalEstimado: 1180,
      totalBase: 1000,
      totalIGV: 180,
      status: "Aprobado",
      paymentStatus: "Pendiente",
      paidAmount: 0,
      accountingClass: "ADMIN_EXPENSE",
      accountingCategory: "Asesorias",
      costCenter: "General",
      loanComponent: "NONE",
      items: [],
    });
    // SOLPED en PEN aprobada por 590 (base 500 + IGV 90).
    await SolpedModel.create({
      solpedNumber: "SOLPED-2026-0101",
      requesterEmail: "a@correo.com",
      moneda: "PEN",
      totalEstimado: 590,
      totalBase: 500,
      totalIGV: 90,
      status: "Aprobado",
      paymentStatus: "Pendiente",
      paidAmount: 0,
      accountingClass: "ADMIN_EXPENSE",
      accountingCategory: "Asesorias",
      costCenter: "General",
      loanComponent: "NONE",
      items: [],
    });

    const res = await request(app)
      .get("/api/v1/finanzas/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const byCurrency = res.body.data.byCurrency;

    // No se mezclan monedas: cada una en su bucket.
    expect(byCurrency.openPayables.PEN).toBe(590);
    expect(byCurrency.openPayables.USD).toBe(1180);

    // El agregado (compatibilidad) suma ambas.
    expect(res.body.data.openPayablesAmount).toBe(590 + 1180);
  });

  test("monthlySeries expone desglose por moneda", async () => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Factura en USD este mes.
    await require("../../models/finanzas/invoice").create({
      invoiceNumber: "F-USD-001",
      pep: "J.2026.001/001",
      valuationId: new (require("mongoose").Types.ObjectId)(),
      valuationNumber: 1,
      amount: 1000,
      baseAmount: 1000,
      netAmount: 1000,
      currency: "USD",
      issueDate: new Date(),
      status: "Pendiente",
    });

    const res = await request(app)
      .get("/api/v1/finanzas/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Buscar el mes actual por la etiqueta que genera el backend (MONTHS_ES).
    const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const labelMesActual = `${MONTHS_ES[new Date().getMonth()]} ${now.getFullYear()}`;
    const month = res.body.data.monthlySeries.find((m) => m.mes === labelMesActual);
    expect(month).toBeTruthy();
    expect(month.billedUSD).toBe(1000);
    expect(month.billedPEN).toBe(0);
  });
});
