import type { RequestHandler } from 'express';
import { errors as erroresJose } from 'jose';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { ErrorAplicacion } from './errores.js';
import type { Identidad, Rol } from '../seguridad/tokens.js';

export type VerificadorToken = (token: string) => Promise<Identidad>;

// "Bearer <token>" con los caracteres válidos de un JWT (base64url y puntos). El nombre del esquema no distingue
// mayúsculas y admite uno o más espacios (RFC 9110, sección 11.1).
const ENCABEZADO_BEARER = /^Bearer +([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

/**
 * Exige un token Bearer válido y deja la identidad en `req.identidad`.
 * Hacia el cliente no se distingue el motivo del rechazo (ausente, expirado, firma inválida...) para no dar
 * pistas a un atacante; en cambio el motivo SÍ se registra (nunca el token) para poder diferenciar un token
 * caducado, que es normal, de una firma falsificada, que puede ser un ataque.
 * Solo los errores del propio token se convierten en 401: cualquier otro fallo (por ejemplo, la base de
 * datos si la verificación llegara a consultarla) se propaga como error interno y no se disfraza de 401.
 */
export function autenticar(verificarToken: VerificadorToken, logger?: Logger): RequestHandler {
  return async (req, _res, next) => {
    const coincidencia = ENCABEZADO_BEARER.exec(req.header('authorization') ?? '');
    const token = coincidencia?.[1];
    if (!token) {
      throw new ErrorAplicacion(401, 'NO_AUTENTICADO', 'Se requiere autenticación.');
    }
    try {
      req.identidad = await verificarToken(token);
    } catch (error) {
      if (error instanceof erroresJose.JOSEError || error instanceof ZodError) {
        const motivo = error instanceof ZodError ? 'CLAIMS_INVALIDOS' : (error.code ?? error.name);
        logger?.warn({ idSolicitud: req.id, motivo }, 'Token rechazado');
        throw new ErrorAplicacion(401, 'TOKEN_INVALIDO', 'El token es inválido o ha expirado.');
      }
      throw error;
    }
    next();
  };
}

/** Autorización por rol (control de acceso a nivel de función). Debe ir después de `autenticar`. */
export function autorizar(...rolesPermitidos: Rol[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.identidad) {
      throw new ErrorAplicacion(401, 'NO_AUTENTICADO', 'Se requiere autenticación.');
    }
    if (!rolesPermitidos.includes(req.identidad.rol)) {
      throw new ErrorAplicacion(403, 'ACCESO_DENEGADO', 'No tiene permisos para realizar esta acción.');
    }
    next();
  };
}
