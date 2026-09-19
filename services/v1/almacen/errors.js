/**
 * Errores de negocio del módulo Almacén.
 *
 * Mismo patrón que `services/v1/comercial/errors.js`: el ServiceError lleva el
 * código HTTP asociado para que el controller lo traduzca sin acoplarse a Express.
 */
class ServiceError extends Error {
  constructor(message, status = 500, details = undefined) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.details = details;
  }
}

const notFound = (message = 'Recurso no encontrado') =>
  new ServiceError(message, 404);

const badRequest = (message = 'Solicitud inválida') =>
  new ServiceError(message, 400);

module.exports = { ServiceError, notFound, badRequest };
