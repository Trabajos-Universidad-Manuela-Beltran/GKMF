import { randomUUID } from 'node:crypto';
import cors from 'cors';
import type { Express, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Entorno } from '../config/entorno.js';
import { ErrorAplicacion } from './errores.js';

// Solo se acepta un X-Request-Id entrante si tiene un formato inofensivo (evita inyección en logs).
const FORMATO_ID_SOLICITUD = /^[A-Za-z0-9-]{8,64}$/;

/** Asigna un identificador de correlación a cada solicitud y lo devuelve en X-Request-Id. */
export const asignarIdSolicitud: RequestHandler = (req, res, next) => {
  const entrante = req.header('x-request-id');
  req.id = entrante && FORMATO_ID_SOLICITUD.test(entrante) ? entrante : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

/** Las respuestas contienen datos financieros personales: ningún navegador o proxy debe guardarlas. */
const sinCache: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};

/**
 * Limitador propio de los endpoints públicos de autenticación (registro, inicio de sesión, renovación): son los que
 * un atacante usaría para adivinar contraseñas o agotar la CPU (cada hash scrypt es costoso), por eso su tope es
 * mucho más bajo que el general. Se crea por aplicación para que cada instancia (y cada prueba) tenga su propio contador.
 */
export function crearLimitadorAutenticacion(entorno: Pick<Entorno, 'AUTH_RATE_LIMIT_WINDOW_MS' | 'AUTH_RATE_LIMIT_MAX'>): RequestHandler {
  return rateLimit({
    windowMs: entorno.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: entorno.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new ErrorAplicacion(429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos de autenticación. Intente de nuevo más tarde.'));
    },
  });
}

/**
 * Configura las defensas transversales de la API (OWASP API Security Top 10, A08:
 * configuración incorrecta de seguridad): cabeceras seguras, CORS con lista blanca,
 * limitador de solicitudes y no divulgación de la tecnología del servidor.
 */
export function configurarSeguridad(app: Express, entorno: Entorno): void {
  app.disable('x-powered-by');
  app.set('trust proxy', entorno.TRUST_PROXY);

  app.use(asignarIdSolicitud);

  app.use(
    helmet({
      // Una API JSON no debe cargar ni incrustar nada: la política más restrictiva posible.
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      // Lista blanca exacta; vacía = ninguna. Los clientes sin cabecera Origin (app móvil) no dependen de CORS.
      origin: entorno.CORS_ORIGINS,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      credentials: false,
      maxAge: 600,
    }),
  );

  app.use(sinCache);

  app.use(
    rateLimit({
      windowMs: entorno.RATE_LIMIT_WINDOW_MS,
      limit: entorno.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => {
        next(new ErrorAplicacion(429, 'DEMASIADAS_SOLICITUDES', 'Demasiadas solicitudes. Intente de nuevo más tarde.'));
      },
    }),
  );
}
