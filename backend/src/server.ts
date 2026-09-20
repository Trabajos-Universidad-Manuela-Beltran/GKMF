import { componerAplicacion } from './composicion.js';
import { cargarEntorno, type Entorno } from './config/entorno.js';
import { crearLogger } from './utilidades/logger.js';

/** Plazo máximo para terminar las solicitudes en curso antes de forzar la salida. */
const PLAZO_APAGADO_MS = 10_000;

/** Una configuración inválida se informa con un mensaje claro (solo nombres de variables) y no con una traza de Node. */
function cargarEntornoOSalir(): Entorno {
  try {
    return cargarEntorno();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

const entorno = cargarEntornoOSalir();
const logger = crearLogger(entorno);
const { app, conexion } = componerAplicacion(entorno, logger);

/**
 * En producción la API se niega a arrancar con una cuenta administrativa de base de datos (mínimo privilegio).
 * Si no se puede comprobar, también se detiene: un control de seguridad que falla en silencio no protege.
 */
async function exigirMinimoPrivilegio(): Promise<void> {
  if (entorno.NODE_ENV !== 'production') {
    return;
  }
  try {
    if (await conexion.esCuentaPrivilegiada()) {
      logger.fatal('La cuenta de base de datos es administrativa (sysadmin o db_owner); use la cuenta de mínimo privilegio (database/04_seguridad_rol_api.sql)');
      process.exit(1);
    }
  } catch (error) {
    logger.fatal({ err: error }, 'No se pudieron verificar los privilegios de la cuenta de base de datos');
    process.exit(1);
  }
}

await exigirMinimoPrivilegio();

// En Express 5 el callback de listen también recibe el error de apertura del puerto (EADDRINUSE, EACCES...):
// si se ignorara, el proceso registraría "escuchando" y terminaría con código 0 sin que nadie se entere.
const servidor = app.listen(entorno.PORT, entorno.HOST, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, 'No se pudo abrir el puerto');
    process.exit(1);
  }
  logger.info({ host: entorno.HOST, puerto: entorno.PORT, entorno: entorno.NODE_ENV }, 'GKMF API escuchando');
});

let apagando = false;
function apagar(motivo: string, codigoSalida: number): void {
  if (apagando) {
    return;
  }
  apagando = true;
  logger.info({ motivo }, 'Apagando el servidor');

  const forzar = setTimeout(() => {
    logger.error('El apagado ordenado excedió el plazo; se fuerza la salida');
    process.exit(1);
  }, PLAZO_APAGADO_MS);
  forzar.unref();

  servidor.close(() => {
    conexion
      .cerrar()
      .catch((error: unknown) => logger.error({ err: error }, 'Error al cerrar el pool'))
      .finally(() => process.exit(codigoSalida));
  });
}

process.on('SIGTERM', () => apagar('SIGTERM', 0));
process.on('SIGINT', () => apagar('SIGINT', 0));
process.on('unhandledRejection', (razon) => {
  logger.fatal({ err: razon }, 'Promesa rechazada sin manejar');
  apagar('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Excepción no capturada');
  apagar('uncaughtException', 1);
});
