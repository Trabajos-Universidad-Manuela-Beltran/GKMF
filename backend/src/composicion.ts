import type { Express } from 'express';
import type { Logger } from 'pino';
import { crearApp } from './app.js';
import type { Entorno } from './config/entorno.js';
import { crearConexion, type Conexion } from './db/conexion.js';
import { crearRepositorioEducacion } from './modulos/educacion/educacion.repositorio.js';
import { crearServicioEducacion } from './modulos/educacion/educacion.servicio.js';
import { crearServicioTokens } from './seguridad/tokens.js';

export interface Aplicacion {
  app: Express;
  conexion: Conexion;
}

/**
 * Raíz de composición: el único lugar donde se construyen y conectan las piezas reales
 * (base de datos, repositorios, servicios, tokens). Lo usan el servidor y las pruebas de integración.
 */
export function componerAplicacion(entorno: Entorno, logger: Logger): Aplicacion {
  const conexion = crearConexion(entorno, (error) => logger.error({ err: error }, 'Error en el pool de conexiones'));
  const tokens = crearServicioTokens(entorno);

  const app = crearApp({
    entorno,
    logger,
    verificarBaseDeDatos: () => conexion.verificar(),
    verificarToken: (token) => tokens.verificar(token),
    servicioEducacion: crearServicioEducacion(crearRepositorioEducacion(conexion)),
  });

  return { app, conexion };
}
