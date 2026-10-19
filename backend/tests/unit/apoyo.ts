import { vi } from 'vitest';
import { cargarEntorno, type Entorno } from '../../src/config/entorno.js';
import type { ServicioCuentas } from '../../src/modulos/cuentas/cuentas.servicio.js';
import type { ServicioMetas } from '../../src/modulos/metas/metas.servicio.js';

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

// --- Servicios simulados para las pruebas de rutas (no tocan la base de datos) -------------------------------------

export const USUARIO_PRUEBA = { id: 7, nombres: 'Ana María', apellidos: 'Pérez', correo: 'ana@example.com', rol: 'USUARIO' as const, fechaRegistro: '2026-10-01T10:00:00.000Z' };

export function crearServicioCuentasFalso(): ServicioCuentas {
  const tokens = { tokenAcceso: 'acceso.falso.firma', tokenRefresco: 'R'.repeat(43), tipoToken: 'Bearer' as const, expiraEnSegundos: 900 };
  return {
    registrar: vi.fn(async () => USUARIO_PRUEBA),
    iniciarSesion: vi.fn(async () => ({ ...tokens, usuario: USUARIO_PRUEBA })),
    renovar: vi.fn(async () => tokens),
    cerrarSesion: vi.fn(async () => undefined),
  };
}

export const META_PRUEBA = {
  id: 1,
  codigoGlobal: '11111111-1111-4111-8111-111111111111',
  nombre: 'Mercado del mes',
  descripcion: null,
  icono: null,
  montoObjetivo: 100_000,
  montoAhorrado: 72_000,
  porcentaje: 72,
  fechaLimite: '2026-12-30',
  estado: 'EN_PROGRESO' as const,
  fechaCreacion: '2026-10-01T15:00:00.000Z',
};

export const MOVIMIENTO_PRUEBA = {
  id: 5,
  codigoGlobal: '22222222-2222-4222-8222-222222222222',
  tipo: 'DEPOSITO_META',
  monto: 20_000,
  descripcion: 'Depósito a meta de ahorro',
  fecha: '2026-10-18T22:00:00.000Z',
  idMeta: 1,
  nombreMeta: 'Mercado del mes',
};

export function crearServicioMetasFalso(): ServicioMetas {
  const resumen = { totalAhorrado: 72_000, metasActivas: 1, metasCompletadas: 0, metasPausadas: 0, promedioProgreso: 72, netoEsteMes: 20_000 };
  return {
    crearMeta: vi.fn(async () => ({ meta: META_PRUEBA, creada: true })),
    listarMetas: vi.fn(async () => ({ metas: [META_PRUEBA], resumen })),
    obtenerMeta: vi.fn(async () => META_PRUEBA),
    depositar: vi.fn(async () => ({ meta: META_PRUEBA, movimiento: MOVIMIENTO_PRUEBA, creado: true })),
    retirar: vi.fn(async () => ({ meta: META_PRUEBA, movimiento: { ...MOVIMIENTO_PRUEBA, tipo: 'RETIRO_META' }, creado: true })),
    listarMovimientos: vi.fn(async () => ({ movimientos: [MOVIMIENTO_PRUEBA], paginacion: { pagina: 1, limite: 20, total: 1, totalPaginas: 1 } })),
  };
}
