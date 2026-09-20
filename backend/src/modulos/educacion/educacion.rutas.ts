import { Router } from 'express';
import { obtenerValidado, validar } from '../../middlewares/validacion.js';
import {
  consultaLecciones,
  parametrosCategoria,
  type ConsultaLecciones,
  type ParametrosCategoria,
} from './educacion.esquemas.js';
import type { ServicioEducacion } from './educacion.servicio.js';

/**
 * Rutas de educación financiera (se montan bajo /api/v1/educacion, ya autenticadas).
 * El controlador es delgado a propósito: valida, delega en el servicio y da formato a la respuesta.
 */
export function crearRutasEducacion(servicio: ServicioEducacion): Router {
  const router = Router();

  router.get('/categorias', async (_req, res) => {
    res.json({ exito: true, datos: await servicio.listarCategorias() });
  });

  router.get(
    '/categorias/:idCategoria/lecciones',
    validar({ params: parametrosCategoria, query: consultaLecciones }),
    async (_req, res) => {
      const { params, query } = obtenerValidado<ParametrosCategoria, ConsultaLecciones>(res);
      const { lecciones, paginacion } = await servicio.listarLecciones(params.idCategoria, query.pagina, query.limite);
      res.json({ exito: true, datos: lecciones, paginacion });
    },
  );

  return router;
}
