/**
 * Middleware de autenticación para el backend Express.
 *
 * Valida el Bearer token JWT emitido por NextAuth (frontend) y firmado con
 * el secreto compartido `AUTH_JWT_SECRET` (mismo valor que usa el frontend
 * para generar `session.accessToken`).
 *
 * Uso en rutas:
 *   router.get("/ruta", authMiddleware, controller.handler)
 *
 * Si el token falta o es inválido responde 401; no deja pasar la petición.
 */
const jwt = require("jsonwebtoken");

const extractBearerToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== "string") return null;

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  return token;
};

const authMiddleware = (req, res, next) => {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return res.status(401).json({ message: "No autorizado: falta token" });
    }

    // Se lee en cada petición para permitir configuración dinámica en tests.
    const jwtSecret = process.env.AUTH_JWT_SECRET || process.env.NEXTAUTH_SECRET;

    if (!jwtSecret) {
      console.error("AUTH_JWT_SECRET no está definido en el backend");
      return res.status(500).json({ message: "Error de configuración del servidor" });
    }

    const decoded = jwt.verify(token, jwtSecret, {
      algorithms: ["HS256"],
    });

    // Adjunta la identidad validada a la petición para los controllers.
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
    };

    return next();
  } catch (error) {
    // Token inválido, expirado o mal formado.
    return res.status(401).json({ message: "No autorizado: token inválido o expirado" });
  }
};

module.exports = authMiddleware;
