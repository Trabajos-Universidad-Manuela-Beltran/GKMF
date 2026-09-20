import { describe, expect, it, vi } from 'vitest';
import { crearConexion, crearConfiguracionSql } from '../../src/db/conexion.js';
import { crearEntornoPrueba } from './apoyo.js';

describe('configuración de la conexión a SQL Server', () => {
  it('mapea el entorno a la configuración del driver', () => {
    const entorno = crearEntornoPrueba({ DB_SERVER: 'db.interna', DB_PORT: '1444', DB_POOL_MAX: '5', DB_TRUST_SERVER_CERTIFICATE: 'true' });
    const configuracion = crearConfiguracionSql(entorno);
    expect(configuracion).toMatchObject({
      server: 'db.interna',
      port: 1444,
      database: 'GKMF',
      user: 'usuario_prueba',
      options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
      pool: { max: 5, min: 0 },
    });
  });

  it('cifra la conexión y no confía en certificados autofirmados por defecto', () => {
    const configuracion = crearConfiguracionSql(crearEntornoPrueba());
    expect(configuracion.options?.encrypt).toBe(true);
    expect(configuracion.options?.trustServerCertificate).toBe(false);
  });
});

describe('comportamiento sin base de datos disponible', () => {
  // Puerto 1 de la interfaz local: rechaza la conexión de inmediato.
  const entornoSinBd = crearEntornoPrueba({ DB_SERVER: '127.0.0.1', DB_PORT: '1', DB_TIMEOUT_MS: '1000', DB_ENCRYPT: 'false' });

  it('verificar() devuelve false en lugar de lanzar', async () => {
    const conexion = crearConexion(entornoSinBd);
    expect(await conexion.verificar()).toBe(false);
    await conexion.cerrar();
  });

  it('conTransaccion propaga el error de conexión y no ejecuta el trabajo', async () => {
    const conexion = crearConexion(entornoSinBd);
    const trabajo = vi.fn();
    await expect(conexion.conTransaccion(trabajo)).rejects.toThrow();
    expect(trabajo).not.toHaveBeenCalled();
  });

  it('esCuentaPrivilegiada() propaga el error si no se puede consultar (el arranque en producción falla cerrado)', async () => {
    const conexion = crearConexion(entornoSinBd);
    await expect(conexion.esCuentaPrivilegiada()).rejects.toThrow();
    await conexion.cerrar();
  });

  it('cerrar() sin pool abierto no falla', async () => {
    await expect(crearConexion(entornoSinBd).cerrar()).resolves.toBeUndefined();
  });
});
