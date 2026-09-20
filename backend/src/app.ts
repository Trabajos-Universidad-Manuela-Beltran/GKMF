import express, { Router, type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Entorno } from './config/entorno.js';
import { autenticar, type VerificadorToken } from './middlewares/autenticacion.js';
import { crearManejadorErrores, manejadorNoEncontrado } from './middlewares/errores.js';
import { configurarSeguridad } from './middlewares/seguridad.js';
import { crearRutasEducacion } from './modulos/educacion/educacion.rutas.js';
import type { ServicioEducacion } from './modulos/educacion/educacion.servicio.js';
import { crearRutasSalud } from './modulos/salud/salud.rutas.js';

/** Todo lo que la aplicación necesita del exterior; permite reemplazarlo en las pruebas. */
export interface DependenciasApp {
  entorno: Entorno;
  logger: Logger;
  verificarBaseDeDatos: () => Promise<boolean>;
  verificarToken: VerificadorToken;
  servicioEducacion: ServicioEducacion;
}

/** Límite del cuerpo JSON: los datos de GKMF son pequeños; un límite bajo frena abusos de memoria. */
const LIMITE_CUERPO = '100kb';

export function crearApp(dependencias: DependenciasApp): Express {
  const { entorno, logger } = dependencias;
  const app = express();

  configurarSeguridad(app, entorno);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      // Las sondas de salud son ruido en el registro.
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/v1/salud') },
      // Solo lo necesario para auditar: nunca cabeceras completas ni la cadena de consulta.
      serializers: {
        req: (req: { id?: string | number; method?: string; url?: string; remoteAddress?: string; raw?: { ip?: string } }) => ({
          id: req.id,
          metodo: req.method,
          ruta: (req.url ?? '').split('?')[0],
          // req.raw.ip respeta TRUST_PROXY (IP del cliente real); remoteAddress sería la del proxy.
          ip: req.raw?.ip ?? req.remoteAddress,
        }),
        res: (res: { statusCode?: number }) => ({ estado: res.statusCode }),
      },
    }),
  );

  app.use(express.json({ limit: LIMITE_CUERPO, strict: true }));

  // API versionada: los cambios incompatibles se publican en /api/v2 sin romper a los clientes móviles instalados.
  const v1 = Router();
  v1.use('/salud', crearRutasSalud(dependencias.verificarBaseDeDatos)); // única parte pública
  // Denegación por defecto: desde aquí TODO exige un token válido, incluida cualquier ruta que se agregue después
  // (un módulo nuevo no puede quedar expuesto por olvido) y las rutas inexistentes, que responden 401 sin revelar cuáles existen.
  v1.use(autenticar(dependencias.verificarToken, logger));
  v1.use('/educacion', crearRutasEducacion(dependencias.servicioEducacion));
  app.use('/api/v1', v1);

  app.use(manejadorNoEncontrado);
  app.use(crearManejadorErrores(logger));

  return app;
}
