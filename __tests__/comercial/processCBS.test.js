/**
 * Tests de integración del procesamiento de archivos Excel CBS.
 * Verifica el bug corregido de validación (trim) a nivel de archivo.
 */
const { connect, disconnect } = require("../helpers/mongo");
const { buildCBSWorkbookBuffer } = require("../helpers/excel");
const service = require("../../services/v1/comercial/service");

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnect();
});

const filaValida = {
  PEP: "COD",
  Nivel: "1",
  Carga: "A",
  Descripcion: "Nivel 1",
  Venta: 1000,
  Porcentaje_venta: 1,
  Costo: 600,
  Porcentaje_costo: 1,
  Moneda: "PEN",
};

describe("processCBS", () => {
  test("devuelve filas válidas cuando el archivo está correcto", async () => {
    const buffer = buildCBSWorkbookBuffer([filaValida]);
    const result = service.processCBS(buffer);

    expect(result.length).toBe(1);
    expect(result[0].isValid).toBe(true);
    expect(result[0].Errors).toEqual([]);
  });

  test("detecta fila con PEP vacío (bug de trim corregido)", async () => {
    const buffer = buildCBSWorkbookBuffer([
      { ...filaValida, PEP: "" },
    ]);
    const result = service.processCBS(buffer);

    expect(result.length).toBe(1);
    expect(result[0].isValid).toBe(false);
    expect(result[0].Errors).toContain("PEP vacio");
    expect(result[0].Message).toContain("PEP vacio");
  });

  test("detecta fila con Nivel vacío", async () => {
    const buffer = buildCBSWorkbookBuffer([
      { ...filaValida, Nivel: "" },
    ]);
    const result = service.processCBS(buffer);

    expect(result[0].isValid).toBe(false);
    expect(result[0].Errors).toContain("Nivel vacio");
  });

  test("detecta múltiples errores en una fila", async () => {
    const buffer = buildCBSWorkbookBuffer([
      { ...filaValida, PEP: "", Nivel: "", Venta: "no-numero" },
    ]);
    const result = service.processCBS(buffer);

    expect(result[0].isValid).toBe(false);
    expect(result[0].Errors).toEqual(
      expect.arrayContaining(["PEP vacio", "Nivel vacio", "Venta no es un numero"]),
    );
    expect(result[0].Message).toContain("PEP vacio");
    expect(result[0].Message).toContain("Venta no es un numero");
  });

  test("filtra filas completamente vacías", async () => {
    const buffer = buildCBSWorkbookBuffer([
      filaValida,
      { PEP: "", Nivel: "", Carga: "", Descripcion: "", Venta: "", Costo: "", Porcentaje_venta: "", Porcentaje_costo: "", Moneda: "" },
    ]);
    const result = service.processCBS(buffer);

    expect(result.length).toBe(1);
    expect(result[0].isValid).toBe(true);
  });

  test("lanza error si el buffer no es un Excel válido", async () => {
    expect(() => service.processCBS(Buffer.from("no es excel"))).toThrow();
  });

  test("lanza error si no llega buffer", async () => {
    expect(() => service.processCBS(undefined)).toThrow();
  });
});
