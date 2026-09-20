import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearConexion } from '../../src/db/conexion.js';
import { crearEntornoPrueba } from './apoyo.js';

// Controlador de la transacción simulada: cada prueba decide cómo responden begin, commit, rollback y batch.
const control = vi.hoisted(() => ({
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  batch: vi.fn(),
}));

vi.mock('mssql', () => {
  class ConnectionPool {
    on() {
      return this;
    }
    async connect() {
      return this;
    }
    async close() {}
    request() {
      return { query: async () => ({ recordset: [{ ok: 1 }] }) };
    }
  }
  class Transaction {
    begin(aislamiento?: number) {
      return control.begin(aislamiento);
    }
    commit() {
      return control.commit();
    }
    rollback() {
      return control.rollback();
    }
    request() {
      return { batch: (texto: string) => control.batch(texto) };
    }
  }
  return { default: { ConnectionPool, Transaction, ISOLATION_LEVEL: { READ_COMMITTED: 2, SERIALIZABLE: 4 } } };
});

const SERIALIZABLE = 4;
const RESTABLECER = 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED;';
const errorConCodigo = (codigo: string) => Object.assign(new Error(`error simulado ${codigo}`), { code: codigo });

describe('conTransaccion (con mssql simulado)', () => {
  const entorno = crearEntornoPrueba({ DB_TIMEOUT_MS: '1000' });

  beforeEach(() => {
    control.begin.mockReset().mockResolvedValue(undefined);
    control.commit.mockReset().mockResolvedValue(undefined);
    control.rollback.mockReset().mockResolvedValue(undefined);
    control.batch.mockReset().mockResolvedValue(undefined);
  });

  it('confirma (COMMIT) y devuelve el resultado si el trabajo termina bien', async () => {
    const conexion = crearConexion(entorno);
    const resultado = await conexion.conTransaccion(async () => 'listo');
    expect(resultado).toBe('listo');
    expect(control.commit).toHaveBeenCalledOnce();
    expect(control.rollback).not.toHaveBeenCalled();
    expect(control.batch).not.toHaveBeenCalled(); // READ COMMITTED (por defecto) no necesita restablecerse
  });

  it('restablece READ COMMITTED antes del COMMIT cuando se pidió otro nivel de aislamiento', async () => {
    const conexion = crearConexion(entorno);
    await conexion.conTransaccion(async () => undefined, SERIALIZABLE);
    expect(control.begin).toHaveBeenCalledWith(SERIALIZABLE);
    expect(control.batch).toHaveBeenCalledWith(RESTABLECER);
    expect(control.batch.mock.invocationCallOrder[0]).toBeLessThan(control.commit.mock.invocationCallOrder[0] ?? 0);
  });

  it('revierte (ROLLBACK) y relanza el error original si el trabajo falla', async () => {
    const conexion = crearConexion(entorno);
    await expect(
      conexion.conTransaccion(async () => {
        throw new Error('falló el trabajo');
      }, SERIALIZABLE),
    ).rejects.toThrow('falló el trabajo');
    expect(control.rollback).toHaveBeenCalledOnce();
    expect(control.commit).not.toHaveBeenCalled();
    expect(control.batch).toHaveBeenCalledWith(RESTABLECER); // también se intenta restablecer el aislamiento
  });

  it('un fallo al restablecer el aislamiento no impide el ROLLBACK', async () => {
    control.batch.mockRejectedValue(errorConCodigo('EREQINPROG'));
    const conexion = crearConexion(entorno);
    await expect(
      conexion.conTransaccion(async () => {
        throw new Error('falló el trabajo');
      }, SERIALIZABLE),
    ).rejects.toThrow('falló el trabajo');
    expect(control.rollback).toHaveBeenCalledOnce();
  });

  it('si el COMMIT falla, revierte y propaga el error', async () => {
    control.commit.mockRejectedValue(new Error('falló el commit'));
    const conexion = crearConexion(entorno);
    await expect(conexion.conTransaccion(async () => 'x')).rejects.toThrow('falló el commit');
    expect(control.rollback).toHaveBeenCalledOnce();
  });

  it('reintenta el ROLLBACK mientras haya una consulta en curso (EREQINPROG) hasta lograrlo', async () => {
    control.rollback
      .mockRejectedValueOnce(errorConCodigo('EREQINPROG'))
      .mockRejectedValueOnce(errorConCodigo('EREQINPROG'))
      .mockResolvedValueOnce(undefined);
    const alFallar = vi.fn();
    const conexion = crearConexion(entorno, alFallar);

    await expect(
      conexion.conTransaccion(async () => {
        throw new Error('falló con una consulta en curso');
      }),
    ).rejects.toThrow('falló con una consulta en curso');

    expect(control.rollback).toHaveBeenCalledTimes(3);
    expect(alFallar).not.toHaveBeenCalled();
  });

  it('se rinde y avisa si el ROLLBACK sigue sin poder ejecutarse pasado el plazo', async () => {
    control.rollback.mockRejectedValue(errorConCodigo('EREQINPROG'));
    const alFallar = vi.fn();
    const conexion = crearConexion(entorno, alFallar); // plazo de 1 s (DB_TIMEOUT_MS)

    await expect(
      conexion.conTransaccion(async () => {
        throw new Error('falló el trabajo');
      }),
    ).rejects.toThrow('falló el trabajo'); // el error original no se pierde
    expect(control.rollback.mock.calls.length).toBeGreaterThan(1);
    expect(alFallar).toHaveBeenCalledOnce();
  });

  it.each(['EABORT', 'ENOTBEGUN'])('%s en el ROLLBACK significa "ya revertida": no se reintenta ni se avisa', async (codigo) => {
    control.rollback.mockRejectedValue(errorConCodigo(codigo));
    const alFallar = vi.fn();
    const conexion = crearConexion(entorno, alFallar);
    await expect(
      conexion.conTransaccion(async () => {
        throw new Error('falló el trabajo');
      }),
    ).rejects.toThrow('falló el trabajo');
    expect(control.rollback).toHaveBeenCalledOnce();
    expect(alFallar).not.toHaveBeenCalled();
  });

  it('un error inesperado en el ROLLBACK se informa por alFallar y no oculta el error original', async () => {
    control.rollback.mockRejectedValue(new Error('la conexión se cayó'));
    const alFallar = vi.fn();
    const conexion = crearConexion(entorno, alFallar);
    await expect(
      conexion.conTransaccion(async () => {
        throw new Error('falló el trabajo');
      }),
    ).rejects.toThrow('falló el trabajo');
    expect(alFallar).toHaveBeenCalledOnce();
  });

  it('si BEGIN falla, intenta liberar la transacción y propaga el error', async () => {
    control.begin.mockRejectedValue(new Error('no se pudo iniciar'));
    control.rollback.mockRejectedValue(errorConCodigo('ENOTBEGUN'));
    const trabajo = vi.fn();
    const conexion = crearConexion(entorno);
    await expect(conexion.conTransaccion(trabajo)).rejects.toThrow('no se pudo iniciar');
    expect(trabajo).not.toHaveBeenCalled();
    expect(control.rollback).toHaveBeenCalledOnce();
  });
});
