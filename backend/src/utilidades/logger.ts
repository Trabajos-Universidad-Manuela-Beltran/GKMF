import { pino, type DestinationStream, type Logger } from 'pino';
import type { Entorno } from '../config/entorno.js';

/** Nombres de campo cuyo valor nunca debe llegar a un registro (con sus variantes más comunes). */
const NOMBRES_SENSIBLES = [
  'password',
  'contrasena',
  'clave',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'hash_contrasena',
  'hash_token_refresco',
];

/**
 * Rutas de los objetos de log cuyo valor se reemplaza antes de escribirse. Cada nombre sensible se cubre en el nivel
 * superior y hasta dos niveles de profundidad (por ejemplo `body.usuario.password`); las cabeceras se cubren aparte.
 */
const CAMPOS_SENSIBLES = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...NOMBRES_SENSIBLES.flatMap((nombre) => [nombre, `*.${nombre}`, `*.*.${nombre}`]),
];

export function crearLogger(entorno: Pick<Entorno, 'LOG_LEVEL'>, destino?: DestinationStream): Logger {
  return pino(
    {
      level: entorno.LOG_LEVEL,
      base: { servicio: 'gkmf-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: CAMPOS_SENSIBLES, censor: '[REDACTADO]' },
    },
    destino,
  );
}
