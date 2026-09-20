import { z } from 'zod';

/** Convierte "true" / "false" (texto de una variable de entorno) en booleano. */
const booleanoTexto = (porDefecto: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(porDefecto)
    .transform((valor) => valor === 'true');

// 32 bytes aleatorios en base64url ocupan 43 caracteres: el mínimo para un secreto HS256 de 256 bits.
const LONGITUD_MINIMA_SECRETO_PRODUCCION = 43;
const VARIEDAD_MINIMA_SECRETO = 12;

/** Un origen CORS válido es exacto (esquema://host[:puerto], sin ruta ni barra final); nunca "*". */
function esOrigenExacto(origen: string): boolean {
  try {
    return origen !== '*' && new URL(origen).origin === origen;
  } catch {
    return false;
  }
}

const esquemaEntorno = z
  .object({
    // Servidor. Si NODE_ENV se omite se asume producción: la opción más estricta (seguro por defecto).
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((valor) =>
        valor
          .split(',')
          .map((origen) => origen.trim())
          .filter((origen) => origen.length > 0),
      ),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),

    // Base de datos SQL Server
    DB_SERVER: z.string().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(1433),
    DB_NAME: z.string().min(1).default('GKMF'),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_ENCRYPT: booleanoTexto('true'),
    DB_TRUST_SERVER_CERTIFICATE: booleanoTexto('false'),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),

    // Tokens JWT
    JWT_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
    JWT_ISSUER: z.string().min(1).default('gkmf-api'),
    JWT_AUDIENCE: z.string().min(1).default('gkmf-app'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  })
  .superRefine((entorno, contexto) => {
    // Cada origen CORS debe ser un origen exacto (esquema://host[:puerto]); nunca "*".
    for (const origen of entorno.CORS_ORIGINS) {
      if (!esOrigenExacto(origen)) {
        contexto.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'cada origen debe ser exacto (por ejemplo https://app.ejemplo.com); no se permite "*"',
        });
      }
    }

    if (entorno.NODE_ENV === 'production') {
      if (!entorno.DB_ENCRYPT) {
        contexto.addIssue({ code: 'custom', path: ['DB_ENCRYPT'], message: 'debe ser true en producción' });
      }
      if (entorno.DB_TRUST_SERVER_CERTIFICATE) {
        contexto.addIssue({
          code: 'custom',
          path: ['DB_TRUST_SERVER_CERTIFICATE'],
          message: 'debe ser false en producción (use un certificado válido)',
        });
      }
      if (entorno.CORS_ORIGINS.some((origen) => !origen.startsWith('https://'))) {
        contexto.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'en producción cada origen debe usar https' });
      }
      if (entorno.LOG_LEVEL === 'debug' || entorno.LOG_LEVEL === 'trace') {
        contexto.addIssue({ code: 'custom', path: ['LOG_LEVEL'], message: 'en producción no se permite debug ni trace' });
      }
      if (entorno.JWT_SECRET.length < LONGITUD_MINIMA_SECRETO_PRODUCCION || new Set(entorno.JWT_SECRET).size < VARIEDAD_MINIMA_SECRETO) {
        contexto.addIssue({
          code: 'custom',
          path: ['JWT_SECRET'],
          message: `en producción debe tener al menos ${LONGITUD_MINIMA_SECRETO_PRODUCCION} caracteres variados (256 bits, por ejemplo 32 bytes aleatorios en base64url)`,
        });
      }
    }
  });

export type Entorno = z.infer<typeof esquemaEntorno>;

/** Error de configuración: el mensaje lista las variables inválidas, nunca sus valores. */
export class ErrorConfiguracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorConfiguracion';
  }
}

/**
 * Valida las variables de entorno y devuelve la configuración tipada.
 * Falla rápido (antes de abrir puertos o conexiones) si falta algo o es inseguro.
 */
export function cargarEntorno(fuente: NodeJS.ProcessEnv = process.env): Entorno {
  const resultado = esquemaEntorno.safeParse(fuente);
  if (resultado.success) {
    return resultado.data;
  }
  const problemas = resultado.error.issues.map((problema) => `  - ${problema.path.join('.') || '(entorno)'}: ${problema.message}`);
  throw new ErrorConfiguracion(`Configuración de entorno inválida:\n${problemas.join('\n')}`);
}
