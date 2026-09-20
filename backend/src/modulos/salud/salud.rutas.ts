import { Router } from 'express';

/**
 * Sondas de estado para monitoreo y orquestadores (públicas, sin datos sensibles).
 *  - GET /salud        : el proceso está vivo (liveness).
 *  - GET /salud/listo  : el proceso y la base de datos responden (readiness).
 */
export function crearRutasSalud(verificarBaseDeDatos: () => Promise<boolean>): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ exito: true, datos: { estado: 'ok' } });
  });

  router.get('/listo', async (_req, res) => {
    const listo = await verificarBaseDeDatos();
    // No se detalla la causa del fallo: solo si el servicio puede atender solicitudes.
    res.status(listo ? 200 : 503).json({ exito: listo, datos: { estado: listo ? 'ok' : 'no_disponible' } });
  });

  return router;
}
