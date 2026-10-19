import { Router } from 'express';
import { obtenerValidado, validar } from '../../middlewares/validacion.js';
import {
  cuerpoLogin,
  cuerpoRefresco,
  cuerpoRegistro,
  type CuerpoLogin,
  type CuerpoRefresco,
  type CuerpoRegistro,
} from './cuentas.esquemas.js';
import type { ServicioCuentas } from './cuentas.servicio.js';

/**
 * Rutas de cuentas (se montan bajo /api/v1/auth). Son públicas por naturaleza (aún no hay token), por eso el
 * ensamblado de la aplicación les antepone un limitador de solicitudes más estricto que el general.
 */
export function crearRutasCuentas(servicio: ServicioCuentas): Router {
  const router = Router();

  router.post('/registro', validar({ body: cuerpoRegistro }), async (_req, res) => {
    const { body } = obtenerValidado<unknown, unknown, CuerpoRegistro>(res);
    res.status(201).json({ exito: true, datos: await servicio.registrar(body) });
  });

  router.post('/login', validar({ body: cuerpoLogin }), async (_req, res) => {
    const { body } = obtenerValidado<unknown, unknown, CuerpoLogin>(res);
    res.json({ exito: true, datos: await servicio.iniciarSesion(body) });
  });

  router.post('/refresco', validar({ body: cuerpoRefresco }), async (_req, res) => {
    const { body } = obtenerValidado<unknown, unknown, CuerpoRefresco>(res);
    res.json({ exito: true, datos: await servicio.renovar(body.tokenRefresco) });
  });

  router.post('/cierre', validar({ body: cuerpoRefresco }), async (_req, res) => {
    const { body } = obtenerValidado<unknown, unknown, CuerpoRefresco>(res);
    await servicio.cerrarSesion(body.tokenRefresco);
    res.status(204).end();
  });

  return router;
}
