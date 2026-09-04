/**
 * Tests de integración HTTP (Supertest) del módulo Proyectos.
 * Levanta una app Express mínima con las rutas reales del módulo,
 * usando mongodb-memory-server.
 *
 * Cubre:
 *  - Autenticación (401 sin token).
 *  - Listado y detalle de proyectos (estructura desde Comercial).
 *  - Actividades e historial.
 *  - Valorizaciones con datos "real" desde SOLPED aprobadas (Logística).
 *  - Dashboard.
 */
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { connect, disconnect, clearDatabase } = require("../helpers/mongo");
const proyectosRoutes = require("../../routes/v1/proyectos/route");
const ComercialModel = require("../../models/comercial/comercial");
const ComercialCBSModel = require("../../models/comercial/comercial_CBS");
const SolpedModel = require("../../models/logistica/solped");
const ProjectTrackingModel = require("../../models/proyectos/project_tracking");

const TEST_SECRET = "test-jwt-secret-proyectos-2026";
const PEP = "J.2026.001/001";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", proyectosRoutes);
  return app;
};

const firmarToken = (email = "proyectos@jovalco.com") =>
  jwt.sign(
    { sub: "u1", email, name: "Proyectos", role: "admin" },
    TEST_SECRET,
    { expiresIn: "1h", algorithm: "HS256" },
  );

let app;
let token;

const seedProyectoAdjudicado = async () => {
  await ComercialModel.create({
    Cliente: "Cliente A",
    Especialidad: "Ingeniería",
    Descripcion: "Proyecto de prueba",
    PEP,
    Estado: "Adjudicado",
    CBSLoad: "Si",
    Moneda: "PEN",
    Monto: 10000,
    Usuario: "Resp@correo.com",
    Correo: "Resp@correo.com",
  });

  await ComercialCBSModel.create([
    {
      PEP,
      ElementoPEP: `${PEP}.01`,
      Nivel: "1",
      Carga: "Si",
      Descripcion: "Nivel 1 habilitado",
      Venta: 8000,
      Costo: 5000,
      Porcentaje_venta: 1,
      Porcentaje_costo: 1,
      Moneda: "PEN",
    },
    {
      PEP,
      ElementoPEP: `${PEP}.02`,
      Nivel: "1",
      Carga: "No",
      Descripcion: "Nivel 1 no habilitado",
      Venta: 2000,
      Costo: 1000,
      Porcentaje_venta: 1,
      Porcentaje_costo: 1,
      Moneda: "PEN",
    },
  ]);
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

describe("Autenticación Proyectos", () => {
  test("rechaza sin token con 401", async () => {
    const res = await request(app).get("/api/v1/proyectos/projects");
    expect(res.status).toBe(401);
  });

  test("rechaza token inválido con 401", async () => {
    const res = await request(app)
      .get("/api/v1/proyectos/projects")
      .set("Authorization", "Bearer invalido");
    expect(res.status).toBe(401);
  });

  test("permite OPTIONS sin token", async () => {
    const res = await request(app).options("/api/v1/proyectos/projects");
    expect(res.status).toBe(200);
  });
});

describe("Listado y detalle de proyectos (integración Comercial)", () => {
  test("lista solo proyectos adjudicados por defecto", async () => {
    await seedProyectoAdjudicado();
    await ComercialModel.create({
      Cliente: "Cliente B",
      Descripcion: "En elaboración",
      PEP: "J.2026.002/001",
      Estado: "En Elaboración",
      Moneda: "PEN",
      Monto: 5,
    });

    const res = await request(app)
      .get("/api/v1/proyectos/projects")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const peps = res.body.data.map((p) => p.pep);
    expect(peps).toContain(PEP);
    expect(peps).not.toContain("J.2026.002/001");
  });

  test("detalle incluye estructura con elementos y su 'real'", async () => {
    await seedProyectoAdjudicado();

    // SOLPED aprobada de Logística que aporta al "real" del elemento .01
    await SolpedModel.create({
      solpedNumber: "SOLPED-2026-0001",
      requesterEmail: "solicitante@correo.com",
      status: "Aprobado",
      items: [{ pep: PEP, elementoPEP: `${PEP}.01`, cantidad: 2, precioEstimado: 100 }],
    });

    const res = await request(app)
      .get(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pep).toBe(PEP);
    expect(res.body.data.estructura.length).toBe(2);

    // El elemento .01 tiene Real = 2*100 = 200 por la SOLPED aprobada
    const elem01 = res.body.data.estructura.find((e) => e.ElementoPEP === `${PEP}.01`);
    expect(elem01).toBeTruthy();
    expect(elem01.Real).toBe(200);
  });

  test("detalle de proyecto inexistente devuelve 404", async () => {
    const res = await request(app)
      .get("/api/v1/proyectos/projects/J.2026.999/999")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe("Actividades e historial", () => {
  test("registra y lista actividad", async () => {
    await seedProyectoAdjudicado();

    const res = await request(app)
      .post(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}/activities`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Ingeniería", startDate: "2026-05-01", endDate: "2026-06-30", progress: 10 });

    expect(res.status).toBe(200);

    const detail = await request(app)
      .get(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}`)
      .set("Authorization", `Bearer ${token}`);

    expect(detail.body.data.actividades.length).toBe(1);
    expect(detail.body.data.actividades[0].name).toBe("Ingeniería");
  });

  test("rechaza actividad con fecha fin anterior a inicio", async () => {
    await seedProyectoAdjudicado();

    const res = await request(app)
      .post(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}/activities`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Actividad", startDate: "2026-06-30", endDate: "2026-05-01" });

    expect(res.status).toBe(400);
  });

  test("registra historial tipo riesgo", async () => {
    await seedProyectoAdjudicado();

    const res = await request(app)
      .post(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}/history`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "riesgo", title: "Riesgo de cronograma", impact: "alto", status: "abierto" });

    expect(res.status).toBe(200);

    const tracking = await ProjectTrackingModel.findOne({ pep: PEP });
    expect(tracking.history.length).toBe(1);
    expect(tracking.history[0].kind).toBe("riesgo");
  });

  test("rechaza historial con kind inválido", async () => {
    await seedProyectoAdjudicado();

    const res = await request(app)
      .post(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}/history`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "invalido", title: "X" });

    expect(res.status).toBe(400);
  });
});

describe("Valorizaciones (integración Comercial + Logística)", () => {
  test("crea valorización manual validando elementos habilitados", async () => {
    await seedProyectoAdjudicado();

    const res = await request(app)
      .post(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}/valuations`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        valuationDate: "2026-07-15",
        comments: "Primera valorización",
        items: [{ elementoPEP: `${PEP}.01`, valorizado: 3000 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.totalValorizado).toBe(3000);
    expect(res.body.data.number).toBe(1);
  });

  test("rechaza valorizar un elemento con Carga != Si", async () => {
    await seedProyectoAdjudicado();

    const res = await request(app)
      .post(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}/valuations`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        valuationDate: "2026-07-15",
        items: [{ elementoPEP: `${PEP}.02`, valorizado: 500 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Carga/);
  });

  test("rechaza valorizar elemento inexistente en la estructura", async () => {
    await seedProyectoAdjudicado();

    const res = await request(app)
      .post(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}/valuations`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        valuationDate: "2026-07-15",
        items: [{ elementoPEP: `${PEP}.999`, valorizado: 100 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no existe en la estructura/);
  });

  test("no permite editar valorización con factura emitida", async () => {
    await seedProyectoAdjudicado();

    const createRes = await request(app)
      .post(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}/valuations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ valuationDate: "2026-07-15", items: [{ elementoPEP: `${PEP}.01`, valorizado: 1000 }] });

    const valuationId = createRes.body.data._id;

    // Simular factura emitida (lo hace el módulo Finanzas al generar factura).
    await ProjectTrackingModel.updateOne(
      { pep: PEP, "valuations._id": valuationId },
      { $set: { "valuations.$.invoiceIssued": true, "valuations.$.invoiceNumber": "F001" } },
    );

    const updateRes = await request(app)
      .put(`/api/v1/proyectos/projects/${encodeURIComponent(PEP)}/valuations/${valuationId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ valuationDate: "2026-07-15", items: [{ elementoPEP: `${PEP}.01`, valorizado: 2000 }] });

    expect(updateRes.status).toBe(400);
    expect(updateRes.body.message).toMatch(/factura/);
  });
});

describe("Dashboard", () => {
  test("devuelve indicadores globales", async () => {
    await seedProyectoAdjudicado();

    const res = await request(app)
      .get("/api/v1/proyectos/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalProjects).toBe(1);
    expect(res.body.data.totalBudget).toBe(10000);
  });
});
