/**
 * Error de negocio con código HTTP asociado.
 * Permite que los controllers traduzcan errores de servicio en respuestas HTTP
 * sin acoplar el servicio a Express (req/res).
 */
class ServiceError extends Error {
  constructor(message, status = 500, details = undefined) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.details = details;
  }
}

const notFound = (message = "Recurso no encontrado") =>
  new ServiceError(message, 404);

const badRequest = (message = "Solicitud inválida") =>
  new ServiceError(message, 400);

module.exports = { ServiceError, notFound, badRequest };
