import { cargarEntorno, type Entorno } from '../../src/config/entorno.js';

/** Variables mínimas válidas; solo para pruebas (los valores no son credenciales reales). */
export const VARIABLES_BASE: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DB_SERVER: '127.0.0.1',
  DB_USER: 'usuario_prueba',
  DB_PASSWORD: 'clave-de-prueba',
  JWT_SECRET: 'secreto-solo-para-pruebas-0123456789-abcdef',
};

export function crearEntornoPrueba(extra: Record<string, string> = {}): Entorno {
  return cargarEntorno({ ...VARIABLES_BASE, ...extra });
}
