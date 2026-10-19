import { Router, type Request } from 'express';
import { ErrorAplicacion } from '../../middlewares/errores.js';
import { obtenerValidado, validar } from '../../middlewares/validacion.js';
import {
  consultaMetas,
  consultaMovimientos,
  cuerpoCrearMeta,
  cuerpoOperacion,
  parametrosMeta,
  type ConsultaMetas,
  type ConsultaMovimientosEntrada,
  type CuerpoCrearMeta,
  type CuerpoOperacion,
  type ParametrosMeta,
} from './metas.esquemas.js';
import type { ServicioMetas } from './metas.servicio.js';

/** El único origen válido del identificador de usuario es el token verificado, nunca el cuerpo ni la URL. */
function idUsuarioDe(req: Request): number {
  if (!req.identidad) {
    throw new ErrorAplicacion(401, 'NO_AUTENTICADO', 'Se requiere autenticación.');
  }
  return req.identidad.idUsuario;
}

/** Rutas de metas de ahorro (bajo /api/v1/metas, ya autenticadas). Controladores delgados: validan y delegan. */
export function crearRutasMetas(servicio: ServicioMetas): Router {
  const router = Router();

  router.post('/', validar({ body: cuerpoCrearMeta }), async (req, res) => {
    const { body } = obtenerValidado<unknown, unknown, CuerpoCrearMeta>(res);
    const { meta, creada } = await servicio.crearMeta(idUsuarioDe(req), body);
    // 201 al crear; 200 si es el reintento de una solicitud ya procesada (mismo código global).
    res.status(creada ? 201 : 200).json({ exito: true, datos: meta });
  });

  router.get('/', validar({ query: consultaMetas }), async (req, res) => {
    const { query } = obtenerValidado<unknown, ConsultaMetas>(res);
    const { metas, resumen } = await servicio.listarMetas(idUsuarioDe(req), query.estado);
    res.json({ exito: true, datos: metas, resumen });
  });

  router.get('/:idMeta', validar({ params: parametrosMeta }), async (req, res) => {
    const { params } = obtenerValidado<ParametrosMeta>(res);
    res.json({ exito: true, datos: await servicio.obtenerMeta(idUsuarioDe(req), params.idMeta) });
  });

  router.post('/:idMeta/depositos', validar({ params: parametrosMeta, body: cuerpoOperacion }), async (req, res) => {
    const { params, body } = obtenerValidado<ParametrosMeta, unknown, CuerpoOperacion>(res);
    const resultado = await servicio.depositar(idUsuarioDe(req), params.idMeta, body);
    res.status(resultado.creado ? 201 : 200).json({ exito: true, datos: { movimiento: resultado.movimiento, meta: resultado.meta } });
  });

  router.post('/:idMeta/retiros', validar({ params: parametrosMeta, body: cuerpoOperacion }), async (req, res) => {
    const { params, body } = obtenerValidado<ParametrosMeta, unknown, CuerpoOperacion>(res);
    const resultado = await servicio.retirar(idUsuarioDe(req), params.idMeta, body);
    res.status(resultado.creado ? 201 : 200).json({ exito: true, datos: { movimiento: resultado.movimiento, meta: resultado.meta } });
  });

  return router;
}

/** Historial de movimientos del usuario (bajo /api/v1/movimientos). */
export function crearRutasMovimientos(servicio: ServicioMetas): Router {
  const router = Router();

  router.get('/', validar({ query: consultaMovimientos }), async (req, res) => {
    const { query } = obtenerValidado<unknown, ConsultaMovimientosEntrada>(res);
    const { movimientos, paginacion } = await servicio.listarMovimientos(idUsuarioDe(req), query);
    res.json({ exito: true, datos: movimientos, paginacion });
  });

  return router;
}
