/**
 * Configuración de Jest para el backend.
 * - testEnvironment: node
 * - El timeout de cada test se incrementa porque los tests de integración
 *   levantan mongodb-memory-server.
 * - Solo se buscan tests dentro de __tests__ para no interferir con la app.
 */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  testTimeout: 30000,
  clearMocks: true,
  verbose: true,
};
