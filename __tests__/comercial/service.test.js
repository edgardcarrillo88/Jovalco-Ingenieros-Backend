/**
 * Tests de integración del servicio comercial usando mongodb-memory-server.
 * Verifican reglas de negocio reales contra una base de datos efímera.
 */
const mongoose = require("mongoose");
const { connect, disconnect, clearDatabase } = require("../helpers/mongo");
const service = require("../../services/v1/comercial/service");

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await disconnect();
});

const propuestaBase = {
  Cliente: "Cliente X",
  Especialidad: "Ingeniería",
  Descripcion: "Trabajo ABC de prueba",
  Usuario: "Juan",
  Cargo: "Jefe",
  Celular: "999999999",
  Correo: "correo@empresa.com",
  Moneda: "PEN",
};

const cbsValido = [
  {
    ElementoPEP: "COD",
    Nivel: 1,
    Carga: "A",
    Descripcion: "Nivel 1",
    Venta: 1000,
    Porcentaje_venta: 1,
    Costo: 600,
    Porcentaje_costo: 1,
    Moneda: "PEN",
  },
  {
    ElementoPEP: "COD.01",
    Nivel: 2,
    Carga: "A",
    Descripcion: "Nivel 2",
    Venta: 500,
    Porcentaje_venta: 0.5,
    Costo: 300,
    Porcentaje_costo: 0.5,
    Moneda: "PEN",
  },
];

describe("generación de PEP", () => {
  test("genera el primer PEP secuencial con formato J.<año>.<seq>/001", async () => {
    const pep = await service.getNextPEP();
    const year = new Date().getFullYear();
    expect(pep).toMatch(new RegExp(`^J\\.${year}\\.\\d{3}/001$`));
  });

  test("genera PEPs secuenciales incrementales", async () => {
    const primero = await service.getNextPEP();
    const segundo = await service.getNextPEP();

    const numPrimero = Number(primero.split(".")[2].split("/")[0]);
    const numSegundo = Number(segundo.split(".")[2].split("/")[0]);

    expect(numSegundo).toBe(numPrimero + 1);
  });
});

describe("createSingleData", () => {
  test("crea propuesta sin CBS con monto 0 y estado En Elaboración", async () => {
    const result = await service.createSingleData({
      data: { ...propuestaBase, CBSLoad: "No" },
      CBS: [],
    });

    expect(result.message).toBe("Datos cargados correctamente");

    const creado = await mongoose.model("Comercial").findOne({
      Descripcion: propuestaBase.Descripcion,
    });

    expect(creado).not.toBeNull();
    expect(creado.Estado).toBe("En Elaboración");
    expect(creado.CBSLoad).toBe("No");
    expect(creado.Monto).toBe(0);
    expect(creado.PEP).toBeTruthy();
    expect(creado.Comentarios).toBe("");

    const history = await mongoose.model("ComercialHistory").findOne({
      PEP: creado.PEP,
    });
    expect(history).not.toBeNull();
  });

  test("crea propuesta con CBS calculando el monto del nivel 1", async () => {
    const result = await service.createSingleData({
      data: { ...propuestaBase, CBSLoad: "Si", Comentarios: "Nota interna" },
      CBS: cbsValido,
    });

    expect(result.message).toBe("Datos cargados correctamente");

    const creado = await mongoose.model("Comercial").findOne({
      Descripcion: propuestaBase.Descripcion,
    });

    expect(creado.CBSLoad).toBe("Si");
    expect(creado.Monto).toBe(1000);
    expect(creado.Comentarios).toBe("Nota interna");

    const cbsGuardado = await mongoose.model("ComercialCBS").find({
      PEP: creado.PEP,
    });
    expect(cbsGuardado.length).toBe(2);

    const nivel1 = cbsGuardado.find((i) => Number(i.Nivel) === 1);
    expect(nivel1.ElementoPEP).toBe(creado.PEP);

    const cbsHistory = await mongoose.model("ComercialCBSHistory").find({
      PEP: creado.PEP,
    });
    expect(cbsHistory.length).toBe(2);
  });

  test("lanza error si CBSLoad es Si pero no se envían líneas CBS", async () => {
    await expect(
      service.createSingleData({
        data: { ...propuestaBase, CBSLoad: "Si" },
        CBS: [],
      }),
    ).rejects.toThrow("no se recibieron líneas CBS");
  });

  test("lanza error si faltan campos obligatorios", async () => {
    await expect(
      service.createSingleData({
        data: { Cliente: "X" },
        CBS: [],
      }),
    ).rejects.toThrow("El campo Especialidad es obligatorio");
  });

  test("lanza error si no llega data", async () => {
    await expect(
      service.createSingleData({ data: undefined, CBS: [] }),
    ).rejects.toThrow("obligatorio");
  });
});

describe("getPropuestas y getPropuestaSingle", () => {
  test("devuelve lista paginada", async () => {
    for (let i = 0; i < 3; i++) {
      await service.createSingleData({
        data: { ...propuestaBase, Descripcion: `Propuesta ${i}`, CBSLoad: "No" },
        CBS: [],
      });
    }

    const result = await service.getPropuestas({ page: 1, limit: 10 });
    expect(result.totalDocs).toBe(3);
    expect(result.docs.length).toBe(3);
  });

  test("lanza 400 ante id inválido", async () => {
    await expect(service.getPropuestaSingle("id-invalido")).rejects.toMatchObject({
      status: 400,
    });
  });

  test("lanza 404 cuando la propuesta no existe", async () => {
    const id = new mongoose.Types.ObjectId().toString();
    await expect(service.getPropuestaSingle(id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("updateSingleData", () => {
  test("actualiza propuesta y guarda histórico", async () => {
    const creado = await service.createSingleData({
      data: { ...propuestaBase, CBSLoad: "Si" },
      CBS: cbsValido,
    });

    const doc = await mongoose.model("Comercial").findOne({
      Descripcion: propuestaBase.Descripcion,
    });

    const result = await service.updateSingleData({
      data: {
        ...doc.toObject(),
        Estado: "Enviado",
        Descripcion: "Descripción actualizada",
      },
      CBS: cbsValido.map((c) => ({ ...c, _id: new mongoose.Types.ObjectId().toString() })),
    });

    expect(result.message).toBe("Datos actualizados correctamente");

    const actualizado = await mongoose.model("Comercial").findById(doc._id);
    expect(actualizado.Estado).toBe("Enviado");
    expect(actualizado.Descripcion).toBe("Descripción actualizada");

    const history = await mongoose.model("ComercialHistory").find({ PEP: doc.PEP });
    expect(history.length).toBe(2); // 1 de creación + 1 de update
  });

  test("lanza 404 si la propuesta no existe", async () => {
    const id = new mongoose.Types.ObjectId().toString();
    await expect(
      service.updateSingleData({
        data: { ...propuestaBase, _id: id },
        CBS: [],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("lanza 400 si el id no es un ObjectId válido", async () => {
    await expect(
      service.updateSingleData({
        data: { ...propuestaBase, _id: "no-valido" },
        CBS: [],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("createAditionalData", () => {
  test("genera PEP adicional basado en la raíz existente", async () => {
    await service.createSingleData({
      data: { ...propuestaBase, CBSLoad: "No" },
      CBS: [],
    });

    const original = await mongoose.model("Comercial").findOne();
    const pepOriginal = original.PEP; // ej J.2026.001/001
    const raiz = pepOriginal.split("/")[0];

    const result = await service.createAditionalData({
      data: {
        ...propuestaBase,
        PEP: pepOriginal,
        Descripcion: "Adicional 1",
        CBSLoad: "No",
      },
    });

    expect(result.message).toBe("Datos cargados correctamente");

    const adicional = await mongoose.model("Comercial").findOne({
      Descripcion: "Adicional 1",
    });

    expect(adicional.PEP).toBe(`${raiz}/002`);
  });
});

describe("createCliente", () => {
  test("crea un cliente válido", async () => {
    const cliente = await service.createCliente({ Empresa: "Empresa XYZ", RUC: "123" });
    expect(cliente.Empresa).toBe("Empresa XYZ");
  });

  test("lanza error si no tiene empresa", async () => {
    await expect(service.createCliente({ RUC: "123" })).rejects.toThrow(
      "obligatorio",
    );
  });
});

describe("getCBS", () => {
  test("devuelve el CBS de la propuesta por su PEP", async () => {
    const creado = await service.createSingleData({
      data: { ...propuestaBase, CBSLoad: "Si" },
      CBS: cbsValido,
    });

    const doc = await mongoose.model("Comercial").findOne();
    const cbs = await service.getCBS(doc._id.toString());

    expect(Array.isArray(cbs)).toBe(true);
    expect(cbs.length).toBe(2);
    expect(cbs.every((item) => item.PEP === doc.PEP)).toBe(true);
  });

  test("lanza 404 si la propuesta no existe", async () => {
    const id = new mongoose.Types.ObjectId().toString();
    await expect(service.getCBS(id)).rejects.toMatchObject({ status: 404 });
  });
});
