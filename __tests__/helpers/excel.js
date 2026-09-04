/**
 * Helper para construir archivos Excel (xlsx) en memoria y usarlos
 * en los tests de proceso de CBS.
 */
const xlsx = require("xlsx");

/**
 * Crea un buffer de un archivo Excel con una hoja "CBS".
 * @param {Array<Record<string, unknown>>} rows Filas a escribir
 * @returns {Buffer}
 */
const buildCBSWorkbookBuffer = (rows) => {
  const worksheet = xlsx.utils.json_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "CBS");
  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
};

module.exports = { buildCBSWorkbookBuffer };
