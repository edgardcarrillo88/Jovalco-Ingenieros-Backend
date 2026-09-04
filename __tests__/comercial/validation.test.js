/**
 * Tests unitarios de las funciones de validación del módulo comercial.
 * Estas funciones son puras (no requieren base de datos).
 */
const {
  validateCBSRow,
  normalizeCBSLoad,
  rebuildCBSElementoPEP,
  isEmptyRow,
} = require("../../services/v1/comercial/service");

describe("validateCBSRow", () => {
  test("marca error cuando PEP está vacío (bug de trim corregido)", () => {
    const fila = {
      PEP: "",
      Nivel: "1",
      Carga: "X",
      Descripcion: "Desc",
      Moneda: "PEN",
      Venta: 100,
      Porcentaje_venta: 1,
      Costo: 50,
      Porcentaje_costo: 0.5,
    };

    const result = validateCBSRow(fila);
    expect(result.isValid).toBe(false);
    expect(result.Errors).toContain("PEP vacio");
  });

  test("marca error cuando Nivel está vacío", () => {
    const fila = {
      PEP: "X",
      Nivel: "",
      Carga: "X",
      Descripcion: "Desc",
      Moneda: "PEN",
      Venta: 100,
      Porcentaje_venta: 1,
      Costo: 50,
      Porcentaje_costo: 0.5,
    };

    const result = validateCBSRow(fila);
    expect(result.isValid).toBe(false);
    expect(result.Errors).toContain("Nivel vacio");
  });

  test("marca error cuando Venta no es número", () => {
    const fila = {
      PEP: "X",
      Nivel: "1",
      Carga: "X",
      Descripcion: "Desc",
      Moneda: "PEN",
      Venta: "100",
      Porcentaje_venta: 1,
      Costo: 50,
      Porcentaje_costo: 0.5,
    };

    const result = validateCBSRow(fila);
    expect(result.isValid).toBe(false);
    expect(result.Errors).toContain("Venta no es un numero");
  });

  test("fila completamente válida", () => {
    const fila = {
      PEP: "PEP-1",
      Nivel: "1",
      Carga: "Carga",
      Descripcion: "Descripción",
      Moneda: "PEN",
      Venta: 100,
      Porcentaje_venta: 1,
      Costo: 50,
      Porcentaje_costo: 0.5,
    };

    const result = validateCBSRow(fila);
    expect(result.isValid).toBe(true);
    expect(result.Errors).toEqual([]);
    expect(result.Message).toBeUndefined();
  });

  test("no muta la fila original", () => {
    const fila = {
      PEP: "",
      Nivel: "1",
      Carga: "X",
      Descripcion: "Desc",
      Moneda: "PEN",
      Venta: 100,
      Porcentaje_venta: 1,
      Costo: 50,
      Porcentaje_costo: 0.5,
    };
    const snapshot = { ...fila };

    validateCBSRow(fila);

    expect(fila).toEqual(snapshot);
    expect(fila.Errors).toBeUndefined();
  });

  test("acepta moneda en minúsculas y la normaliza", () => {
    const fila = {
      PEP: "PEP-1",
      Nivel: "1",
      Carga: "Carga",
      Descripcion: "Desc",
      Moneda: "pen",
      Venta: 100,
      Porcentaje_venta: 1,
      Costo: 50,
      Porcentaje_costo: 0.5,
    };

    const result = validateCBSRow(fila);
    expect(result.isValid).toBe(true);
  });

  test("marca error con moneda no válida", () => {
    const fila = {
      PEP: "PEP-1",
      Nivel: "1",
      Carga: "Carga",
      Descripcion: "Desc",
      Moneda: "EUR",
      Venta: 100,
      Porcentaje_venta: 1,
      Costo: 50,
      Porcentaje_costo: 0.5,
    };

    const result = validateCBSRow(fila);
    expect(result.isValid).toBe(false);
    expect(result.Errors).toContain("Moneda no valida");
  });
});

describe("normalizeCBSLoad", () => {
  test("convierte 'Si' en 'Si'", () => {
    expect(normalizeCBSLoad("Si")).toBe("Si");
  });

  test("convierte 'si' (minúsculas) en 'Si'", () => {
    expect(normalizeCBSLoad("si")).toBe("Si");
  });

  test("convierte true en 'Si'", () => {
    expect(normalizeCBSLoad(true)).toBe("Si");
  });

  test("convierte cualquier otro valor en 'No'", () => {
    expect(normalizeCBSLoad("No")).toBe("No");
    expect(normalizeCBSLoad(undefined)).toBe("No");
    expect(normalizeCBSLoad("")).toBe("No");
    expect(normalizeCBSLoad(false)).toBe("No");
  });
});

describe("rebuildCBSElementoPEP", () => {
  test("reemplaza el código de nivel 1 por el PEP general", () => {
    const CBS = [
      {
        ElementoPEP: "COD1",
        Nivel: 1,
        Descripcion: "Nivel 1",
      },
      {
        ElementoPEP: "COD1.01",
        Nivel: 2,
        Descripcion: "Nivel 2",
      },
    ];

    const result = rebuildCBSElementoPEP(CBS, "J.2026.001/001");

    expect(result[0].ElementoPEP).toBe("J.2026.001/001");
    expect(result[1].ElementoPEP).toBe("J.2026.001/001.01");
    expect(result[0].PEP).toBe("J.2026.001/001");
  });

  test("lanza error si no existe fila de nivel 1", () => {
    const CBS = [
      {
        ElementoPEP: "COD1.01",
        Nivel: 2,
        Descripcion: "Nivel 2",
      },
    ];

    expect(() => rebuildCBSElementoPEP(CBS, "J.2026.001/001")).toThrow(
      "No se encontró una fila CBS de nivel 1",
    );
  });

  test("retorna array vacío si CBS es nulo o vacío", () => {
    expect(rebuildCBSElementoPEP(undefined, "PEP")).toEqual([]);
    expect(rebuildCBSElementoPEP([], "PEP")).toEqual([]);
  });
});

describe("isEmptyRow", () => {
  test("detecta fila vacía", () => {
    expect(
      isEmptyRow({
        PEP: "",
        Nivel: "",
        Carga: "",
        Descripcion: "",
        Venta: "",
        Porcentaje_venta: "",
        Costo: "",
        Porcentaje_costo: "",
        Moneda: "",
      }),
    ).toBe(true);
  });

  test("detecta fila con contenido", () => {
    expect(
      isEmptyRow({
        PEP: "X",
        Nivel: "",
      }),
    ).toBe(false);
  });
});
