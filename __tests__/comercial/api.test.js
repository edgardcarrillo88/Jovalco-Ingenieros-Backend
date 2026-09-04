/**
 * Tests de integración HTTP (Supertest) de los endpoints comerciales.
 * Levanta una app Express mínima con las rutas reales del módulo,
 * usando mongodb-memory-server como base de datos.
 *
 * Incluye pruebas de autenticación: las rutas requieren un Bearer token JWT
 * firmado con el secreto compartido (AUTH_JWT_SECRET).
 */
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { connect, disconnect, clearDatabase } = require("../helpers/mongo");
const { buildCBSWorkbookBuffer } = require("../helpers/excel");
const comercialRoutes = require("../../routes/v1/comercial/route");
const ComercialModel = require("../../models/comercial/comercial");
const ClientesModel = require("../../models/comercial/clientes");

const TEST_SECRET = "test-jwt-secret-comercial-2026";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", comercialRoutes);
  return app;
};

/** Firma un token de prueba válido con el secreto compartido. */
const firmarToken = (overrides = {}) =>
  jwt.sign(
    {
      sub: "e2e-user",
      email: "test@jovalco.com",
      name: "Test User",
      role: "admin",
      ...overrides,
    },
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

describe("Autenticación", () => {
  test("rechaza petición sin token con 401", async () => {
    const res = await request(app).get("/api/v1/comercial/getclientes");
    expect(res.status).toBe(401);
  });

  test("rechaza petición con token inválido con 401", async () => {
    const res = await request(app)
      .get("/api/v1/comercial/getclientes")
      .set("Authorization", "Bearer token-invalido");
    expect(res.status).toBe(401);
  });

  test("rechaza token firmado con otro secreto", async () => {
    const otroToken = jwt.sign({ sub: "x" }, "otro-secreto", {
      algorithm: "HS256",
    });
    const res = await request(app)
      .get("/api/v1/comercial/getclientes")
      .set("Authorization", `Bearer ${otroToken}`);
    expect(res.status).toBe(401);
  });

  test("permite el preflight OPTIONS sin token", async () => {
    const res = await request(app).options("/api/v1/comercial/getclientes");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/v1/comercial/getclientes", () => {
  test("devuelve lista de clientes con token válido", async () => {
    await ClientesModel.create({ Empresa: "Cliente A" });

    const res = await request(app)
      .get("/api/v1/comercial/getclientes")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].Empresa).toBe("Cliente A");
  });
});

describe("POST /api/v1/comercial/createsingledata", () => {
  const propuestaValida = {
    data: {
      Cliente: "Cliente X",
      Especialidad: "Ingeniería",
      Descripcion: "Propuesta de prueba",
      Usuario: "Juan",
      Cargo: "Jefe",
      Celular: "999999999",
      Correo: "correo@empresa.com",
      Moneda: "PEN",
      CBSLoad: "No",
    },
    CBS: [],
  };

  test("crea propuesta y responde 200", async () => {
    const res = await request(app)
      .post("/api/v1/comercial/createsingledata")
      .set("Authorization", `Bearer ${token}`)
      .send(propuestaValida);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Datos cargados correctamente");

    const creada = await ComercialModel.findOne();
    expect(creada).not.toBeNull();
    expect(creada.Estado).toBe("En Elaboración");
  });

  test("responde 400 cuando falta data obligatoria", async () => {
    const res = await request(app)
      .post("/api/v1/comercial/createsingledata")
      .set("Authorization", `Bearer ${token}`)
      .send({ data: { Cliente: "Solo cliente" }, CBS: [] });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/comercial/getpropuestas", () => {
  test("devuelve propuestas paginadas", async () => {
    const pep1 = "J.2026.001/001";
    const pep2 = "J.2026.001/002";
    await ComercialModel.create([
      {
        Cliente: "A",
        Especialidad: "Ing",
        Descripcion: "P1",
        PEP: pep1,
        Estado: "Enviado",
        CBSLoad: "No",
        Moneda: "PEN",
        Monto: 100,
      },
      {
        Cliente: "B",
        Especialidad: "Diseño",
        Descripcion: "P2",
        PEP: pep2,
        Estado: "En Elaboración",
        CBSLoad: "No",
        Moneda: "PEN",
        Monto: 200,
      },
    ]);

    const res = await request(app)
      .get("/api/v1/comercial/getpropuestas")
      .set("Authorization", `Bearer ${token}`)
      .query({ page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.totalDocs).toBe(2);
    expect(res.body.data.docs.length).toBe(2);
  });
});

describe("GET /api/v1/comercial/getpropuestassingle", () => {
  test("responde 400 ante id inválido", async () => {
    const res = await request(app)
      .get("/api/v1/comercial/getpropuestassingle")
      .set("Authorization", `Bearer ${token}`)
      .query({ id: "no-valido" });

    expect(res.status).toBe(400);
  });

  test("responde 404 ante id inexistente", async () => {
    const id = new (require("mongoose").Types.ObjectId)().toString();
    const res = await request(app)
      .get("/api/v1/comercial/getpropuestassingle")
      .set("Authorization", `Bearer ${token}`)
      .query({ id });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/comercial/getwbs", () => {
  test("responde 400 ante id inválido", async () => {
    const res = await request(app)
      .get("/api/v1/comercial/getwbs")
      .set("Authorization", `Bearer ${token}`)
      .query({ id: "no-valido" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/comercial/processwbs", () => {
  test("procesa archivo Excel válido (multipart)", async () => {
    const buffer = buildCBSWorkbookBuffer([
      {
        PEP: "COD",
        Nivel: "1",
        Carga: "A",
        Descripcion: "Nivel 1",
        Venta: 1000,
        Porcentaje_venta: 1,
        Costo: 600,
        Porcentaje_costo: 1,
        Moneda: "PEN",
      },
    ]);

    const res = await request(app)
      .post("/api/v1/comercial/processwbs")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", buffer, "cbs.xlsx");

    expect(res.status).toBe(200);
    expect(res.body.datos.length).toBe(1);
    expect(res.body.datos[0].isValid).toBe(true);
  });

  test("responde 400 si no se envía archivo", async () => {
    const res = await request(app)
      .post("/api/v1/comercial/processwbs")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
