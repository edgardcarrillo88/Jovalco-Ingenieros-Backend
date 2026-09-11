/**
 * Tests unitarios de la regla de negocio del estado contractual
 * (backend/services/v1/administracion/personalService.js).
 *
 * Regla:
 *  - Vencido          → la fecha de vencimiento ya pasó
 *  - Próximo a vencer → vence dentro de los próximos 30 días (1 mes)
 *  - Vigente          → vence en más de 30 días
 *  - Pendiente de firma / Cesado → estados manuales, no se recalculan
 *
 * La fecha de vencimiento = (fechaRenovacion si hay renovación, si no fechaIngreso)
 *                           + (tiempoRenovacion | tiempoContrato) meses
 */
const {
  ESTADO_CONTRATO,
  calcularFechaVencimientoContrato,
  calcularEstadoContrato,
  withEstadoContrato,
  calcularGastoPlanilla,
} = require("../../services/v1/administracion/personalService");

/** Fecha de referencia fija para que los tests sean deterministas. */
const HOY = new Date(2026, 8, 11); // 11 de septiembre de 2026

describe("calcularFechaVencimientoContrato", () => {
  test("suma los meses de tiempoContrato a la fecha de ingreso", () => {
    const fecha = calcularFechaVencimientoContrato({
      fechaIngreso: new Date(2025, 1, 15), // 15/02/2025
      tiempoContrato: 15,
    });

    expect(fecha.toISOString().slice(0, 10)).toBe("2026-05-15");
  });

  test("prioriza la renovación cuando existe fecha y tiempo de renovación", () => {
    const fecha = calcularFechaVencimientoContrato({
      fechaIngreso: new Date(2020, 0, 1),
      tiempoContrato: 12,
      fechaRenovacion: new Date(2026, 0, 10),
      tiempoRenovacion: 6,
    });

    expect(fecha.toISOString().slice(0, 10)).toBe("2026-07-10");
  });

  test("ignora la renovación si no tiene tiempo de renovación", () => {
    const fecha = calcularFechaVencimientoContrato({
      fechaIngreso: new Date(2026, 0, 10),
      tiempoContrato: 3,
      fechaRenovacion: new Date(2026, 5, 1),
      tiempoRenovacion: 0,
    });

    expect(fecha.toISOString().slice(0, 10)).toBe("2026-04-10");
  });

  test("devuelve null si no hay fecha base", () => {
    expect(calcularFechaVencimientoContrato({})).toBeNull();
    expect(calcularFechaVencimientoContrato({ tiempoContrato: 12 })).toBeNull();
  });
});

describe("calcularEstadoContrato", () => {
  test("marca Vencido cuando la fecha de vencimiento ya pasó", () => {
    const personal = { fechaIngreso: new Date(2025, 1, 15), tiempoContrato: 15 };

    // Caso real reportado: vence el 15/05/2026 y hoy es 11/09/2026.
    expect(calcularEstadoContrato(personal, HOY)).toBe(ESTADO_CONTRATO.VENCIDO);
  });

  test("marca Vencido un día después del vencimiento", () => {
    const personal = { fechaIngreso: new Date(2025, 8, 10), tiempoContrato: 12 };

    expect(calcularEstadoContrato(personal, HOY)).toBe(ESTADO_CONTRATO.VENCIDO);
  });

  test("marca Próximo a vencer el mismo día del vencimiento", () => {
    const personal = { fechaIngreso: new Date(2025, 8, 11), tiempoContrato: 12 };

    expect(calcularEstadoContrato(personal, HOY)).toBe(
      ESTADO_CONTRATO.PROXIMO_A_VENCER,
    );
  });

  test("marca Próximo a vencer dentro del límite de 30 días", () => {
    // 11/10/2025 + 12 meses = 11/10/2026 → exactamente 30 días después del 11/09/2026.
    const personal = { fechaIngreso: new Date(2025, 9, 11), tiempoContrato: 12 };

    expect(calcularEstadoContrato(personal, HOY)).toBe(
      ESTADO_CONTRATO.PROXIMO_A_VENCER,
    );
  });

  test("marca Vigente cuando vence en más de 30 días", () => {
    // 12/10/2025 + 12 meses = 12/10/2026 → 31 días después del 11/09/2026.
    const personal = { fechaIngreso: new Date(2025, 9, 12), tiempoContrato: 12 };

    expect(calcularEstadoContrato(personal, HOY)).toBe(ESTADO_CONTRATO.VIGENTE);
  });

  test("marca Vigente cuando vence en más de 30 días (contrato largo)", () => {
    const personal = { fechaIngreso: new Date(2026, 8, 12), tiempoContrato: 12 };

    expect(calcularEstadoContrato(personal, HOY)).toBe(ESTADO_CONTRATO.VIGENTE);
  });

  test("marca Vigente si no hay fecha de vencimiento calculable", () => {
    expect(calcularEstadoContrato({}, HOY)).toBe(ESTADO_CONTRATO.VIGENTE);
  });

  test("respeta el estado manual Cesado aunque el contrato esté vencido", () => {
    const personal = {
      fechaIngreso: new Date(2024, 0, 1),
      tiempoContrato: 12,
      estado: "Cesado",
    };

    expect(calcularEstadoContrato(personal, HOY)).toBe("Cesado");
  });

  test("respeta el estado manual Pendiente de firma aunque el contrato esté vencido", () => {
    const personal = {
      fechaIngreso: new Date(2024, 0, 1),
      tiempoContrato: 12,
      estado: "Pendiente de firma",
    };

    expect(calcularEstadoContrato(personal, HOY)).toBe("Pendiente de firma");
  });

  test("recalcula el estado guardado cuando no es un estado manual", () => {
    const personal = {
      fechaIngreso: new Date(2025, 1, 15),
      tiempoContrato: 15,
      estado: "Próximo a vencer", // valor obsoleto guardado en la BD
    };

    expect(calcularEstadoContrato(personal, HOY)).toBe(ESTADO_CONTRATO.VENCIDO);
  });
});

describe("withEstadoContrato", () => {
  test("añade el estado derivado y la fecha de vencimiento sin mutar el registro", () => {
    const personal = {
      _id: "abc",
      fechaIngreso: new Date(2025, 1, 15),
      tiempoContrato: 15,
      estado: "Próximo a vencer",
    };

    const resultado = withEstadoContrato(personal, HOY);

    expect(resultado.estado).toBe(ESTADO_CONTRATO.VENCIDO);
    expect(resultado.fechaVencimientoContrato).toBe(
      new Date(2026, 4, 15).toISOString(),
    );
    expect(resultado._id).toBe("abc");
    expect(personal.estado).toBe("Próximo a vencer");
    expect(personal.fechaVencimientoContrato).toBeUndefined();
  });
});

describe("calcularGastoPlanilla", () => {
  test("suma sueldoPlanilla + sueldoRh del personal no cesado", () => {
    const resultado = calcularGastoPlanilla([
      { estado: "Vigente", sueldoPlanilla: 1000, sueldoRh: 500 }, // 1500
      { estado: "Vencido", sueldoPlanilla: 2000, sueldoRh: 1000 }, // 3000
      { estado: "Próximo a vencer", sueldoPlanilla: 500, sueldoRh: 250 }, // 750
    ]);

    expect(resultado.gastoPlanilla).toBe(5250);
    expect(resultado.personalConsiderado).toBe(3);
  });

  test("excluye a los cesados de la suma", () => {
    const resultado = calcularGastoPlanilla([
      { estado: "Vigente", sueldoPlanilla: 1000, sueldoRh: 500 }, // 1500
      { estado: "Cesado", sueldoPlanilla: 9000, sueldoRh: 9000 }, // excluido
    ]);

    expect(resultado.gastoPlanilla).toBe(1500);
    expect(resultado.personalConsiderado).toBe(1);
  });

  test("cuenta los sueldos no informados como 0", () => {
    const resultado = calcularGastoPlanilla([
      { estado: "Vigente", sueldoPlanilla: 1000, sueldoRh: 0 },
      { estado: "Vigente", sueldoPlanilla: 2000 },
      { estado: "Vigente" },
    ]);

    expect(resultado.gastoPlanilla).toBe(3000);
    expect(resultado.personalConsiderado).toBe(3);
  });

  test("devuelve 0 cuando no hay personal considerado", () => {
    expect(calcularGastoPlanilla([])).toEqual({
      gastoPlanilla: 0,
      personalConsiderado: 0,
    });

    expect(
      calcularGastoPlanilla([{ estado: "Cesado", sueldoPlanilla: 1000 }]),
    ).toEqual({ gastoPlanilla: 0, personalConsiderado: 0 });
  });
});
