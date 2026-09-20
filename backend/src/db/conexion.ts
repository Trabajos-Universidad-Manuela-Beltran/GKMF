import sql from 'mssql';
import type { Entorno } from '../config/entorno.js';

export interface Conexion {
  /** Devuelve el pool de conexiones (se crea la primera vez que se pide). */
  pool(): Promise<sql.ConnectionPool>;
  /** Comprueba que la base de datos responde; nunca lanza. */
  verificar(): Promise<boolean>;
  /**
   * Indica si la cuenta con la que se conecta la API es administrativa (sysadmin o db_owner). La API debe usar una
   * cuenta de mínimo privilegio; en producción el servidor se niega a arrancar si esto devuelve true.
   */
  esCuentaPrivilegiada(): Promise<boolean>;
  /**
   * Ejecuta `trabajo` dentro de una transacción ACID: confirma (COMMIT) si termina bien y
   * revierte (ROLLBACK) si lanza cualquier error. Es la base de las operaciones
   * transaccionales de la Fase III (depósitos, retiros, sincronización).
   * El nivel de aislamiento pedido rige solo dentro de la transacción: al terminar se restablece
   * READ COMMITTED para que no se "pegue" a la conexión que vuelve al pool.
   */
  conTransaccion<T>(trabajo: (transaccion: sql.Transaction) => Promise<T>, aislamiento?: number): Promise<T>;
  /** Cierra el pool (apagado ordenado). */
  cerrar(): Promise<void>;
}

/** Pausa entre reintentos del ROLLBACK cuando aún hay una consulta de la transacción en curso. */
const ESPERA_REINTENTO_ROLLBACK_MS = 250;

export function crearConfiguracionSql(entorno: Entorno): sql.config {
  return {
    server: entorno.DB_SERVER,
    port: entorno.DB_PORT,
    database: entorno.DB_NAME,
    user: entorno.DB_USER,
    password: entorno.DB_PASSWORD,
    connectionTimeout: entorno.DB_TIMEOUT_MS,
    requestTimeout: entorno.DB_TIMEOUT_MS,
    options: {
      encrypt: entorno.DB_ENCRYPT,
      trustServerCertificate: entorno.DB_TRUST_SERVER_CERTIFICATE,
      enableArithAbort: true,
    },
    pool: { max: entorno.DB_POOL_MAX, min: 0, idleTimeoutMillis: 30_000 },
  };
}

const esperar = (milisegundos: number) => new Promise<void>((resolver) => setTimeout(resolver, milisegundos));

function codigoDe(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
}

export function crearConexion(entorno: Entorno, alFallar?: (error: Error) => void): Conexion {
  let promesaPool: Promise<sql.ConnectionPool> | undefined;

  const pool = (): Promise<sql.ConnectionPool> => {
    if (!promesaPool) {
      const nuevo = new sql.ConnectionPool(crearConfiguracionSql(entorno));
      nuevo.on('error', (error: Error) => alFallar?.(error));
      promesaPool = nuevo.connect().catch((error: unknown) => {
        promesaPool = undefined; // permite reintentar en la siguiente solicitud
        throw error;
      });
    }
    return promesaPool;
  };

  /**
   * ROLLBACK que no deja la conexión tomada. Si el trabajo falló mientras otra consulta de la misma transacción seguía en
   * curso, mssql responde EREQINPROG y NO revierte ni libera la conexión: se reintenta hasta el plazo de las consultas.
   * EABORT (el servidor ya la revirtió) y ENOTBEGUN (nunca inició) no requieren nada más.
   */
  const revertir = async (transaccion: sql.Transaction): Promise<void> => {
    const limite = Date.now() + entorno.DB_TIMEOUT_MS;
    for (;;) {
      try {
        await transaccion.rollback();
        return;
      } catch (error) {
        const codigo = codigoDe(error);
        if (codigo === 'EABORT' || codigo === 'ENOTBEGUN') {
          return;
        }
        if (codigo === 'EREQINPROG' && Date.now() < limite) {
          await esperar(ESPERA_REINTENTO_ROLLBACK_MS);
          continue;
        }
        alFallar?.(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  };

  return {
    pool,

    async verificar() {
      try {
        const conexion = await pool();
        await conexion.request().query('SELECT 1 AS ok');
        return true;
      } catch {
        return false;
      }
    },

    async esCuentaPrivilegiada() {
      const resultado = await (await pool())
        .request()
        .query<{ privilegiada: number }>(
          `SELECT CASE WHEN IS_SRVROLEMEMBER('sysadmin') = 1 OR IS_MEMBER('db_owner') = 1 THEN 1 ELSE 0 END AS privilegiada;`,
        );
      return resultado.recordset[0]?.privilegiada === 1;
    },

    async conTransaccion(trabajo, aislamiento = sql.ISOLATION_LEVEL.READ_COMMITTED) {
      const transaccion = new sql.Transaction(await pool());
      const restablecerAislamiento = async () => {
        if (aislamiento !== sql.ISOLATION_LEVEL.READ_COMMITTED) {
          await transaccion.request().batch('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;');
        }
      };
      try {
        await transaccion.begin(aislamiento);
      } catch (error) {
        await revertir(transaccion);
        throw error;
      }
      try {
        const resultado = await trabajo(transaccion);
        await restablecerAislamiento();
        await transaccion.commit();
        return resultado;
      } catch (error) {
        try {
          await restablecerAislamiento();
        } catch {
          // La transacción pudo quedar inutilizable (error grave o consulta en curso); el ROLLBACK la libera igualmente.
        }
        await revertir(transaccion);
        throw error;
      }
    },

    async cerrar() {
      if (promesaPool) {
        const actual = promesaPool;
        promesaPool = undefined;
        await (await actual).close();
      }
    },
  };
}
