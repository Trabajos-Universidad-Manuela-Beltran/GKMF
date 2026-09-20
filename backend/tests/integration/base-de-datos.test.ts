import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { componerAplicacion, type Aplicacion } from '../../src/composicion.js';
import { crearConexion } from '../../src/db/conexion.js';
import { cargarEntorno } from '../../src/config/entorno.js';
import { crearServicioTokens } from '../../src/seguridad/tokens.js';
import { crearLogger } from '../../src/utilidades/logger.js';

/**
 * Pruebas de integración contra SQL Server real (scripts 01 a 04 de /database aplicados y
 * variables de conexión en .env). Se ejecutan con: npm run test:integracion
 */
const entorno = cargarEntorno({ ...process.env, LOG_LEVEL: 'silent' });

let aplicacion: Aplicacion;
let token: string;

beforeAll(async () => {
  aplicacion = componerAplicacion(entorno, crearLogger(entorno));
  token = await crearServicioTokens(entorno).emitir({ idUsuario: 1, rol: 'USUARIO' });
});

afterAll(async () => {
  await aplicacion.conexion.cerrar();
});

const consultar = (ruta: string) => request(aplicacion.app).get(ruta).set('Authorization', `Bearer ${token}`);

async function ejecutar<T>(texto: string, parametros: Record<string, string> = {}): Promise<T[]> {
  const solicitud = (await aplicacion.conexion.pool()).request();
  for (const [nombre, valor] of Object.entries(parametros)) {
    solicitud.input(nombre, sql.NVarChar, valor);
  }
  return (await solicitud.query<T>(texto)).recordset;
}

describe('conexión y cuenta de la API', () => {
  it('la base de datos responde', async () => {
    expect(await aplicacion.conexion.verificar()).toBe(true);
    const respuesta = await request(aplicacion.app).get('/api/v1/salud/listo');
    expect(respuesta.status).toBe(200);
  });

  it('la API NO se conecta con una cuenta administrativa (mínimo privilegio)', async () => {
    const [fila] = await ejecutar<{ sysadmin: number; db_owner: number }>(
      `SELECT IS_SRVROLEMEMBER('sysadmin') AS sysadmin, IS_MEMBER('db_owner') AS db_owner;`,
    );
    expect(fila?.sysadmin).toBe(0);
    expect(fila?.db_owner).toBe(0);
  });

  it('la propia API detecta que su cuenta no es privilegiada (control de arranque en producción)', async () => {
    expect(await aplicacion.conexion.esCuentaPrivilegiada()).toBe(false);
  });

  it('no puede cambiar el rol de un usuario (DENY UPDATE en la columna) pero sí actualizar su perfil', async () => {
    await expect(ejecutar('UPDATE dbo.usuario SET rol = rol WHERE 1 = 0;')).rejects.toMatchObject({ number: 230 });
    await expect(ejecutar('UPDATE dbo.usuario SET idioma = idioma WHERE 1 = 0;')).resolves.toBeUndefined();
  });

  it('no puede borrar filas (DENY DELETE) ni modificar el libro mayor de transacciones', async () => {
    await expect(ejecutar('DELETE FROM dbo.categoria_movimiento WHERE 1 = 0;')).rejects.toMatchObject({ number: 229 });
    await expect(ejecutar('UPDATE dbo.transaccion SET monto = monto WHERE 1 = 0;')).rejects.toMatchObject({ number: 229 });
  });

  it('los parámetros tipados de mssql (el patrón de todos los repositorios) tratan un texto hostil como dato', async () => {
    const hostil = "'; DROP TABLE dbo.logro; --";
    const coincidencias = await ejecutar<{ total: number }>(
      'SELECT COUNT(*) AS total FROM dbo.categoria_leccion WHERE nombre = @nombre;',
      { nombre: hostil },
    );
    expect(coincidencias[0]?.total).toBe(0);
    const logros = await ejecutar<{ total: number }>('SELECT COUNT(*) AS total FROM dbo.logro;');
    expect(logros[0]?.total).toBeGreaterThan(0); // la tabla sigue existiendo
  });
});

describe('transacciones ACID (conTransaccion)', () => {
  it('abre una transacción y respeta el nivel de aislamiento solicitado', async () => {
    const nivel = await aplicacion.conexion.conTransaccion(async (transaccion) => {
      const resultado = await transaccion
        .request()
        .query<{ abiertas: number; aislamiento: number }>(
          'SELECT @@TRANCOUNT AS abiertas, transaction_isolation_level AS aislamiento FROM sys.dm_exec_sessions WHERE session_id = @@SPID;',
        );
      return resultado.recordset[0];
    }, sql.ISOLATION_LEVEL.SERIALIZABLE);
    expect(nivel?.abiertas).toBe(1);
    expect(nivel?.aislamiento).toBe(4); // 4 = SERIALIZABLE
  });

  it('confirma los cambios cuando el trabajo termina bien (COMMIT)', async () => {
    const correo = 'admin.contenido@example.com';
    const consulta = 'SELECT ultimo_acceso AS acceso FROM dbo.usuario WHERE correo = @correo;';
    const antes = await ejecutar<{ acceso: Date }>(consulta, { correo });
    await aplicacion.conexion.conTransaccion(async (transaccion) => {
      await transaccion
        .request()
        .input('correo', sql.NVarChar, correo)
        .query('UPDATE dbo.usuario SET ultimo_acceso = SYSUTCDATETIME() WHERE correo = @correo;');
    });
    const despues = await ejecutar<{ acceso: Date }>(consulta, { correo });
    expect(despues[0]?.acceso.getTime()).toBeGreaterThan(antes[0]?.acceso.getTime() ?? 0);
  });

  it('el nivel de aislamiento pedido no se "pega" a la conexión que vuelve al pool', async () => {
    const conexion = crearConexion({ ...entorno, DB_POOL_MAX: 1 }); // una sola conexión: la siguiente consulta la reutiliza
    try {
      await conexion.conTransaccion(async () => undefined, sql.ISOLATION_LEVEL.SERIALIZABLE);
      const resultado = await (await conexion.pool())
        .request()
        .query<{ nivel: number }>('SELECT transaction_isolation_level AS nivel FROM sys.dm_exec_sessions WHERE session_id = @@SPID;');
      expect(resultado.recordset[0]?.nivel).toBe(2); // 2 = READ COMMITTED
    } finally {
      await conexion.cerrar();
    }
  });

  it('si el trabajo falla con una consulta aún en curso, el ROLLBACK libera la conexión (no se filtra)', async () => {
    const conexion = crearConexion({ ...entorno, DB_POOL_MAX: 1 });
    try {
      await expect(
        conexion.conTransaccion(async (transaccion) => {
          void transaccion.request().query("WAITFOR DELAY '00:00:01';").catch(() => undefined);
          throw new Error('falla con una consulta en curso');
        }),
      ).rejects.toThrow('falla con una consulta en curso');
      // Con la conexión filtrada, esta consulta se quedaría esperando para siempre (pool de 1).
      expect(await conexion.verificar()).toBe(true);
    } finally {
      await conexion.cerrar();
    }
  });

  it('revierte TODO si el trabajo falla (atomicidad)', async () => {
    const nombre = `Prueba ${randomUUID().slice(0, 8)}`; // cabe en NVARCHAR(50)

    await expect(
      aplicacion.conexion.conTransaccion(async (transaccion) => {
        await transaccion
          .request()
          .input('nombre', sql.NVarChar, nombre)
          .query(`INSERT INTO dbo.categoria_movimiento (nombre, tipo) VALUES (@nombre, 'EGRESO');`);

        // Dentro de la transacción el dato existe...
        const dentro = await transaccion
          .request()
          .input('nombre', sql.NVarChar, nombre)
          .query<{ total: number }>('SELECT COUNT(*) AS total FROM dbo.categoria_movimiento WHERE nombre = @nombre;');
        expect(dentro.recordset[0]?.total).toBe(1);

        throw new Error('fallo simulado a mitad de la operación');
      }),
    ).rejects.toThrow('fallo simulado');

    // ...pero tras el ROLLBACK no quedó rastro.
    const despues = await ejecutar<{ total: number }>('SELECT COUNT(*) AS total FROM dbo.categoria_movimiento WHERE nombre = @nombre;', { nombre });
    expect(despues[0]?.total).toBe(0);
  });

  it('revierte cuando el propio motor rechaza un dato (restricción CHECK)', async () => {
    await expect(
      aplicacion.conexion.conTransaccion(async (transaccion) => {
        await transaccion.request().query(`INSERT INTO dbo.categoria_movimiento (nombre, tipo) VALUES (N'Valida temporal', 'EGRESO');`);
        await transaccion.request().query(`INSERT INTO dbo.categoria_movimiento (nombre, tipo) VALUES (N'Invalida temporal', 'OTRO');`);
      }),
    ).rejects.toMatchObject({ number: 547 });

    const rastro = await ejecutar<{ total: number }>(`SELECT COUNT(*) AS total FROM dbo.categoria_movimiento WHERE nombre IN (N'Valida temporal', N'Invalida temporal');`);
    expect(rastro[0]?.total).toBe(0); // ni siquiera la primera inserción (válida) sobrevivió
  });
});

describe('API de educación contra los datos iniciales', () => {
  it('lista las 6 categorías con su número de lecciones', async () => {
    const respuesta = await consultar('/api/v1/educacion/categorias');
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.datos).toHaveLength(6);
    expect(respuesta.body.datos.map((c: { nombre: string }) => c.nombre)).toEqual(
      expect.arrayContaining(['Ahorro', 'Crédito', 'Presupuesto', 'Protección', 'Inversión', 'Familia']),
    );
    expect(respuesta.body.datos.find((c: { nombre: string }) => c.nombre === 'Ahorro')).toMatchObject({ totalLecciones: 2 });
  });

  it('pagina las lecciones de una categoría', async () => {
    const categorias = await consultar('/api/v1/educacion/categorias');
    const idAhorro = categorias.body.datos.find((c: { nombre: string }) => c.nombre === 'Ahorro').id;

    const primera = await consultar(`/api/v1/educacion/categorias/${idAhorro}/lecciones?limite=1&pagina=1`);
    expect(primera.status).toBe(200);
    expect(primera.body.datos).toHaveLength(1);
    expect(primera.body.paginacion).toEqual({ pagina: 1, limite: 1, total: 2, totalPaginas: 2 });
    expect(primera.body.datos[0].titulo).toBe('¿Qué es el ahorro programado?');
    expect(primera.body.datos[0].esDestacada).toBe(true);
    expect(primera.body.datos[0]).not.toHaveProperty('contenido'); // el listado no arrastra el cuerpo de la lección

    const segunda = await consultar(`/api/v1/educacion/categorias/${idAhorro}/lecciones?limite=1&pagina=2`);
    expect(segunda.body.datos[0].titulo).toBe('Cómo fijar tu primera meta de ahorro');

    const fuera = await consultar(`/api/v1/educacion/categorias/${idAhorro}/lecciones?limite=1&pagina=3`);
    expect(fuera.body.datos).toEqual([]);
  });

  it('responde 404 si la categoría no existe', async () => {
    const respuesta = await consultar('/api/v1/educacion/categorias/999999/lecciones');
    expect(respuesta.status).toBe(404);
  });

  it('exige autenticación', async () => {
    const respuesta = await request(aplicacion.app).get('/api/v1/educacion/categorias');
    expect(respuesta.status).toBe(401);
  });
});
