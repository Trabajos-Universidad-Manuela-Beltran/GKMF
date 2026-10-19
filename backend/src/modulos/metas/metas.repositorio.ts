import sql from 'mssql';
import type { Conexion } from '../../db/conexion.js';
import { ErrorAplicacion } from '../../middlewares/errores.js';

export type EstadoMeta = 'EN_PROGRESO' | 'COMPLETADA' | 'PAUSADA' | 'ATRASADA';
export type TipoMovimientoMeta = 'DEPOSITO_META' | 'RETIRO_META';

export interface MetaFila {
  id_meta: number;
  codigo_global: string;
  nombre: string;
  descripcion: string | null;
  icono: string | null;
  monto_objetivo: number;
  monto_ahorrado: number;
  fecha_limite: Date;
  estado: EstadoMeta;
  fecha_creacion: Date;
}

export interface MovimientoFila {
  id_transaccion: number;
  codigo_global: string;
  tipo: string;
  monto: number;
  descripcion: string;
  fecha_movimiento: Date;
  id_meta: number | null;
  nombre_meta: string | null;
}

export interface DatosNuevaMeta {
  nombre: string;
  descripcion: string | null;
  icono: string | null;
  montoObjetivo: number;
  /** Fecha local en formato AAAA-MM-DD. */
  fechaLimite: string;
  codigoGlobal: string;
}

export interface DatosMovimientoMeta {
  idUsuario: number;
  idMeta: number;
  tipo: TipoMovimientoMeta;
  monto: number;
  descripcion: string;
  codigoGlobal: string;
}

/**
 * Acceso a datos de metas y movimientos. TODOS los métodos reciben el `idUsuario` del token (nunca del cuerpo ni de la
 * URL) y lo incluyen en la condición SQL: así un usuario no puede leer ni modificar los datos de otro (OWASP API1, BOLA).
 */
export interface RepositorioMetas {
  contarMetas(idUsuario: number): Promise<number>;
  /** Idempotente por código global: repetir la misma solicitud devuelve la meta ya creada con `creada: false`. */
  crearMeta(idUsuario: number, datos: DatosNuevaMeta): Promise<{ meta: MetaFila; creada: boolean }>;
  listarMetas(idUsuario: number): Promise<MetaFila[]>;
  buscarMeta(idUsuario: number, idMeta: number): Promise<MetaFila | null>;
  /**
   * Depósito o retiro de una meta como UNA transacción ACID: actualiza el saldo y asienta el movimiento en el libro
   * mayor, o no hace ninguna de las dos cosas. Idempotente por código global.
   */
  registrarMovimiento(datos: DatosMovimientoMeta): Promise<{ meta: MetaFila; movimiento: MovimientoFila; creado: boolean }>;
  listarMovimientos(idUsuario: number, idMeta: number | undefined, desplazamiento: number, limite: number): Promise<{ filas: MovimientoFila[]; total: number }>;
  /** Depósitos menos retiros de metas desde la fecha indicada (UTC). */
  netoDesde(idUsuario: number, desdeUtc: Date): Promise<number>;
}

const COLUMNAS_META = `
  m.id_meta, m.codigo_global, m.nombre, m.descripcion, m.icono, m.monto_objetivo, m.monto_ahorrado,
  m.fecha_limite, m.estado, m.fecha_creacion`;

const SALIDA_META = `
  inserted.id_meta, inserted.codigo_global, inserted.nombre, inserted.descripcion, inserted.icono, inserted.monto_objetivo,
  inserted.monto_ahorrado, inserted.fecha_limite, inserted.estado, inserted.fecha_creacion`;

/** Tope de metas devueltas por consulta (el servicio también limita cuántas puede crear cada usuario). */
const MAXIMO_METAS_LISTADAS = 200;

const SQL_CONTAR_METAS = `SELECT COUNT(*) AS total FROM dbo.meta_ahorro WHERE id_usuario = @idUsuario;`;

// La meta solo se crea para una cuenta activa: un token todavía vigente de una cuenta desactivada no sirve.
const SQL_CREAR_META = `
  INSERT INTO dbo.meta_ahorro (id_usuario, codigo_global, nombre, descripcion, icono, monto_objetivo, fecha_limite)
  OUTPUT ${SALIDA_META}
  SELECT u.id_usuario, @codigo, @nombre, @descripcion, @icono, @objetivo, @fecha
    FROM dbo.usuario AS u
   WHERE u.id_usuario = @idUsuario AND u.activo = 1;`;

const SQL_META_POR_CODIGO = `SELECT ${COLUMNAS_META} FROM dbo.meta_ahorro AS m WHERE m.codigo_global = @codigo AND m.id_usuario = @idUsuario;`;

const SQL_LISTAR_METAS = `
  SELECT TOP (${MAXIMO_METAS_LISTADAS}) ${COLUMNAS_META}
    FROM dbo.meta_ahorro AS m
    JOIN dbo.usuario AS u ON u.id_usuario = m.id_usuario AND u.activo = 1
   WHERE m.id_usuario = @idUsuario
   ORDER BY m.fecha_creacion DESC, m.id_meta DESC;`;

const SQL_BUSCAR_META = `
  SELECT ${COLUMNAS_META}
    FROM dbo.meta_ahorro AS m
    JOIN dbo.usuario AS u ON u.id_usuario = m.id_usuario AND u.activo = 1
   WHERE m.id_meta = @idMeta AND m.id_usuario = @idUsuario;`;

// Bloquea la fila de la meta (UPDLOCK: nadie más puede tomarla para actualizar hasta que termine la transacción) y la
// devuelve ya filtrada por propietario y cuenta activa.
const SQL_BLOQUEAR_META = `
  SELECT ${COLUMNAS_META}
    FROM dbo.meta_ahorro AS m WITH (UPDLOCK, ROWLOCK)
    JOIN dbo.usuario AS u ON u.id_usuario = m.id_usuario AND u.activo = 1
   WHERE m.id_meta = @idMeta AND m.id_usuario = @idUsuario;`;

const COLUMNAS_MOVIMIENTO = `
  t.id_transaccion, t.codigo_global, t.tipo, t.monto, t.descripcion, t.fecha_movimiento, t.id_meta, mt.nombre AS nombre_meta`;

const SQL_MOVIMIENTO_POR_CODIGO = `
  SELECT ${COLUMNAS_MOVIMIENTO}, t.id_usuario
    FROM dbo.transaccion AS t
    LEFT JOIN dbo.meta_ahorro AS mt ON mt.id_meta = t.id_meta
   WHERE t.codigo_global = @codigo;`;

// Una sola sentencia hace la comprobación y el cambio de saldo: dos depósitos o retiros simultáneos se serializan por
// el bloqueo de la fila y nunca pisan el saldo del otro. El estado se recalcula junto con el saldo para cumplir
// CK_meta_ahorro_completada (una meta COMPLETADA siempre tiene saldo >= objetivo).
const SQL_DEPOSITAR = `
  UPDATE m
     SET monto_ahorrado = m.monto_ahorrado + @monto,
         estado = CASE WHEN m.monto_ahorrado + @monto >= m.monto_objetivo THEN 'COMPLETADA' ELSE m.estado END,
         fecha_actualizacion = SYSUTCDATETIME()
  OUTPUT ${SALIDA_META}
    FROM dbo.meta_ahorro AS m
    JOIN dbo.usuario AS u ON u.id_usuario = m.id_usuario AND u.activo = 1
   WHERE m.id_meta = @idMeta AND m.id_usuario = @idUsuario AND m.estado IN ('EN_PROGRESO', 'ATRASADA');`;

const SQL_RETIRAR = `
  UPDATE m
     SET monto_ahorrado = m.monto_ahorrado - @monto,
         estado = CASE WHEN m.estado = 'PAUSADA' THEN m.estado
                       WHEN m.monto_ahorrado - @monto >= m.monto_objetivo THEN 'COMPLETADA'
                       WHEN m.estado = 'COMPLETADA' THEN 'EN_PROGRESO'
                       ELSE m.estado END,
         fecha_actualizacion = SYSUTCDATETIME()
  OUTPUT ${SALIDA_META}
    FROM dbo.meta_ahorro AS m
    JOIN dbo.usuario AS u ON u.id_usuario = m.id_usuario AND u.activo = 1
   WHERE m.id_meta = @idMeta AND m.id_usuario = @idUsuario AND m.monto_ahorrado >= @monto;`;

const SQL_ASENTAR_MOVIMIENTO = `
  INSERT INTO dbo.transaccion (id_usuario, id_meta, codigo_global, tipo, monto, descripcion)
  OUTPUT inserted.id_transaccion, inserted.codigo_global, inserted.tipo, inserted.monto, inserted.descripcion,
         inserted.fecha_movimiento, inserted.id_meta
  VALUES (@idUsuario, @idMeta, @codigo, @tipo, @monto, @descripcion);`;

const SQL_MOVIMIENTOS = `
  SELECT ${COLUMNAS_MOVIMIENTO}
    FROM dbo.transaccion AS t
    JOIN dbo.usuario AS u ON u.id_usuario = t.id_usuario AND u.activo = 1
    LEFT JOIN dbo.meta_ahorro AS mt ON mt.id_meta = t.id_meta
   WHERE t.id_usuario = @idUsuario AND (@idMeta IS NULL OR t.id_meta = @idMeta)
   ORDER BY t.fecha_movimiento DESC, t.id_transaccion DESC
  OFFSET @desplazamiento ROWS FETCH NEXT @limite ROWS ONLY;

  SELECT COUNT(*) AS total
    FROM dbo.transaccion AS t
    JOIN dbo.usuario AS u ON u.id_usuario = t.id_usuario AND u.activo = 1
   WHERE t.id_usuario = @idUsuario AND (@idMeta IS NULL OR t.id_meta = @idMeta);`;

const SQL_NETO_DESDE = `
  SELECT COALESCE(SUM(CASE t.tipo WHEN 'DEPOSITO_META' THEN t.monto WHEN 'RETIRO_META' THEN -t.monto END), 0) AS neto
    FROM dbo.transaccion AS t
    JOIN dbo.usuario AS u ON u.id_usuario = t.id_usuario AND u.activo = 1
   WHERE t.id_usuario = @idUsuario AND t.fecha_movimiento >= @desde;`;

/** Error 2627/2601 de SQL Server: se violó una restricción UNIQUE. */
function esViolacionUnica(error: unknown): boolean {
  const numero = typeof error === 'object' && error !== null ? (error as { number?: number }).number : undefined;
  return numero === 2627 || numero === 2601;
}

/** Error 1205 de SQL Server: la transacción fue elegida como víctima de un interbloqueo. */
function esInterbloqueo(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { number?: number }).number === 1205;
}

/** Intentos totales de un movimiento ante una condición transitoria (el primero más dos repeticiones). */
const MAXIMO_INTENTOS_MOVIMIENTO = 3;

/** Error 8115 de SQL Server: desbordamiento aritmético (un saldo que no cabe en DECIMAL(14,2)). */
function esDesbordamientoNumerico(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { number?: number }).number === 8115;
}

const dinero = sql.Decimal(14, 2);

export function crearRepositorioMetas(conexion: Conexion): RepositorioMetas {
  const buscarPorCodigo = async (solicitud: sql.Request, idUsuario: number, codigo: string): Promise<MetaFila | null> => {
    const resultado = await solicitud.input('codigo', sql.UniqueIdentifier, codigo).input('idUsuario', sql.Int, idUsuario).query<MetaFila>(SQL_META_POR_CODIGO);
    return resultado.recordset[0] ?? null;
  };

  type ResultadoMovimiento = { meta: MetaFila; movimiento: MovimientoFila; creado: boolean };

  /** Una pasada completa de la operación, dentro de UNA transacción. */
  const ejecutarMovimiento = (datos: DatosMovimientoMeta): Promise<ResultadoMovimiento> =>
    conexion.conTransaccion(async (transaccion) => {
      // 0. ORDEN DE BLOQUEO FIJO: lo primero es tomar la fila de la meta con un bloqueo de actualización. Todas las
      //    operaciones sobre una meta se ponen en fila desde aquí y siempre toman los recursos en el mismo orden
      //    (meta, luego libro mayor), lo que elimina los interbloqueos que aparecían cuando una solicitud leía el
      //    libro mientras otra ya tenía la meta bloqueada. Si la meta no existe (o es de otro usuario, o la cuenta
      //    está desactivada) no hay fila y se responde 404, sin distinguir los casos.
      const bloqueada = await transaccion.request().input('idMeta', sql.Int, datos.idMeta).input('idUsuario', sql.Int, datos.idUsuario).query<MetaFila>(SQL_BLOQUEAR_META);
      const metaActual = bloqueada.recordset[0];
      if (!metaActual) {
        throw new ErrorAplicacion(404, 'META_NO_ENCONTRADA', 'La meta de ahorro no existe.');
      }

      // 1. ¿Ya se procesó este código? (el cliente reintentó tras perder la respuesta o al sincronizar)
      const previo = await transaccion.request().input('codigo', sql.UniqueIdentifier, datos.codigoGlobal).query<MovimientoFila & { id_usuario: number }>(SQL_MOVIMIENTO_POR_CODIGO);
      const existente = previo.recordset[0];
      if (existente) {
        const mismoMovimiento =
          existente.id_usuario === datos.idUsuario &&
          existente.id_meta === datos.idMeta &&
          existente.tipo === datos.tipo &&
          Number(existente.monto) === datos.monto;
        if (!mismoMovimiento) {
          throw new ErrorAplicacion(409, 'CODIGO_GLOBAL_EN_USO', 'El código de la operación ya se usó con otros datos.');
        }
        const { id_usuario: _propietario, ...movimiento } = existente;
        return { meta: metaActual, movimiento, creado: false };
      }

      // 2. Cambiar el saldo (una sola sentencia atómica con su condición de negocio)
      const actualizacion = await transaccion
        .request()
        .input('idMeta', sql.Int, datos.idMeta)
        .input('idUsuario', sql.Int, datos.idUsuario)
        .input('monto', dinero, datos.monto)
        .query<MetaFila>(datos.tipo === 'DEPOSITO_META' ? SQL_DEPOSITAR : SQL_RETIRAR);
      const meta = actualizacion.recordset[0];
      if (!meta) {
        // La meta está bloqueada por esta transacción: su estado no pudo cambiar desde el paso 0, así que el motivo es seguro.
        if (datos.tipo === 'DEPOSITO_META') {
          throw new ErrorAplicacion(409, 'META_NO_ADMITE_DEPOSITOS', 'La meta está completada o pausada y no admite más depósitos.');
        }
        throw new ErrorAplicacion(409, 'SALDO_INSUFICIENTE', 'La meta no tiene saldo suficiente para ese retiro.');
      }

      // 3. Asentar el movimiento en el libro mayor (solo inserción). Si falla, el saldo también se revierte.
      const asiento = await transaccion
        .request()
        .input('idUsuario', sql.Int, datos.idUsuario)
        .input('idMeta', sql.Int, datos.idMeta)
        .input('codigo', sql.UniqueIdentifier, datos.codigoGlobal)
        .input('tipo', sql.VarChar(14), datos.tipo)
        .input('monto', dinero, datos.monto)
        .input('descripcion', sql.NVarChar(150), datos.descripcion)
        .query<Omit<MovimientoFila, 'nombre_meta'>>(SQL_ASENTAR_MOVIMIENTO);
      return { meta, movimiento: { ...(asiento.recordset[0] as Omit<MovimientoFila, 'nombre_meta'>), nombre_meta: meta.nombre }, creado: true };
    });

  /**
   * Repite la operación completa cuando falla por una condición transitoria. Es seguro porque la operación es
   * idempotente (el código global no cambia entre intentos) y porque cada intento se deshace por completo al fallar:
   *  - violación de UQ_transaccion_codigo_global: otra solicitud con el mismo código ganó la carrera; el nuevo intento
   *    encuentra el movimiento ya asentado y responde como reintento;
   *  - interbloqueo (1205): SQL Server eligió esta transacción como víctima; el orden de bloqueo fijo lo evita en el
   *    caso normal, pero se mantiene el reintento como red de seguridad.
   */
  async function registrarMovimiento(datos: DatosMovimientoMeta): Promise<ResultadoMovimiento> {
    for (let intento = 1; ; intento += 1) {
      try {
        return await ejecutarMovimiento(datos);
      } catch (error) {
        if (intento < MAXIMO_INTENTOS_MOVIMIENTO && (esViolacionUnica(error) || esInterbloqueo(error))) {
          continue;
        }
        if (esDesbordamientoNumerico(error)) {
          throw new ErrorAplicacion(400, 'MONTO_FUERA_DE_RANGO', 'El saldo resultante excede el máximo permitido.');
        }
        throw error;
      }
    }
  }

  return {
    async contarMetas(idUsuario) {
      const resultado = await (await conexion.pool()).request().input('idUsuario', sql.Int, idUsuario).query<{ total: number }>(SQL_CONTAR_METAS);
      return resultado.recordset[0]?.total ?? 0;
    },

    async crearMeta(idUsuario, datos) {
      const pool = await conexion.pool();
      try {
        const resultado = await pool
          .request()
          .input('idUsuario', sql.Int, idUsuario)
          .input('codigo', sql.UniqueIdentifier, datos.codigoGlobal)
          .input('nombre', sql.NVarChar(100), datos.nombre)
          .input('descripcion', sql.NVarChar(250), datos.descripcion)
          .input('icono', sql.VarChar(30), datos.icono)
          .input('objetivo', dinero, datos.montoObjetivo)
          .input('fecha', sql.Date, datos.fechaLimite)
          .query<MetaFila>(SQL_CREAR_META);
        const meta = resultado.recordset[0];
        if (!meta) {
          throw new ErrorAplicacion(403, 'CUENTA_INACTIVA', 'La cuenta no está activa.');
        }
        return { meta, creada: true };
      } catch (error) {
        if (!esViolacionUnica(error)) {
          throw error;
        }
        // Mismo código global: si es del propio usuario es un reintento; si es de otro, es un conflicto.
        const existente = await buscarPorCodigo(pool.request(), idUsuario, datos.codigoGlobal);
        if (!existente) {
          throw new ErrorAplicacion(409, 'CODIGO_GLOBAL_EN_USO', 'El código de la operación ya se usó.');
        }
        return { meta: existente, creada: false };
      }
    },

    async listarMetas(idUsuario) {
      const resultado = await (await conexion.pool()).request().input('idUsuario', sql.Int, idUsuario).query<MetaFila>(SQL_LISTAR_METAS);
      return resultado.recordset;
    },

    async buscarMeta(idUsuario, idMeta) {
      const resultado = await (await conexion.pool()).request().input('idMeta', sql.Int, idMeta).input('idUsuario', sql.Int, idUsuario).query<MetaFila>(SQL_BUSCAR_META);
      return resultado.recordset[0] ?? null;
    },

    registrarMovimiento,

    async listarMovimientos(idUsuario, idMeta, desplazamiento, limite) {
      const resultado = await (await conexion.pool())
        .request()
        .input('idUsuario', sql.Int, idUsuario)
        .input('idMeta', sql.Int, idMeta ?? null)
        .input('desplazamiento', sql.Int, desplazamiento)
        .input('limite', sql.Int, limite)
        .query<[MovimientoFila, { total: number }]>(SQL_MOVIMIENTOS);
      const [filas, totales] = resultado.recordsets;
      return { filas, total: totales[0]?.total ?? 0 };
    },

    async netoDesde(idUsuario, desdeUtc) {
      const resultado = await (await conexion.pool())
        .request()
        .input('idUsuario', sql.Int, idUsuario)
        .input('desde', sql.DateTime2(0), desdeUtc)
        .query<{ neto: number }>(SQL_NETO_DESDE);
      return Number(resultado.recordset[0]?.neto ?? 0);
    },
  };
}
