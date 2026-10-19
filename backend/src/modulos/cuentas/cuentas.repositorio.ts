import sql from 'mssql';
import type { Conexion } from '../../db/conexion.js';
import { ErrorAplicacion } from '../../middlewares/errores.js';
import type { Rol } from '../../seguridad/tokens.js';

/** Fila de `usuario` con lo que necesita el servicio. `bloqueada` y `vigente` se calculan en SQL con la hora del servidor. */
export interface UsuarioFila {
  id_usuario: number;
  nombres: string;
  apellidos: string;
  correo: string;
  hash_contrasena: string;
  rol: Rol;
  activo: boolean;
  bloqueada: boolean;
  fecha_registro: Date;
}

export interface SesionFila {
  id_sesion: number;
  id_usuario: number;
  revocada: boolean;
  vigente: boolean;
}

export interface DatosNuevoUsuario {
  nombres: string;
  apellidos: string;
  correo: string;
  hashContrasena: string;
}

export interface RepositorioCuentas {
  /** Lanza ErrorAplicacion 409 si el correo ya existe. */
  crearUsuario(datos: DatosNuevoUsuario): Promise<UsuarioFila>;
  buscarPorCorreo(correo: string): Promise<UsuarioFila | null>;
  buscarPorId(idUsuario: number): Promise<UsuarioFila | null>;
  /** Suma un intento fallido y, al llegar al máximo, bloquea la cuenta. Es una sola sentencia: no hay carrera entre solicitudes. */
  registrarIntentoFallido(idUsuario: number, maximoIntentos: number, minutosBloqueo: number): Promise<void>;
  /** Reinicia el contador y anota el acceso. Devuelve false si la cuenta está bloqueada o desactivada en este instante. */
  registrarAccesoExitoso(idUsuario: number): Promise<boolean>;
  crearSesion(idUsuario: number, hashToken: string, diasVigencia: number): Promise<void>;
  buscarSesion(hashToken: string): Promise<SesionFila | null>;
  /**
   * Revoca la sesión indicada y crea la siguiente en una sola transacción. Devuelve false (sin cambios) si la sesión
   * ya no estaba activa: eso ocurre cuando dos solicitudes presentan el mismo token de refresco a la vez.
   */
  rotarSesion(idSesionActual: number, idUsuario: number, hashNuevo: string, diasVigencia: number): Promise<boolean>;
  revocarSesion(hashToken: string): Promise<void>;
  revocarSesionesDeUsuario(idUsuario: number): Promise<void>;
}

const COLUMNAS_USUARIO = `
  id_usuario, nombres, apellidos, correo, hash_contrasena, rol, activo, fecha_registro,
  CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta > SYSUTCDATETIME() THEN 1 ELSE 0 END AS bloqueada`;

interface FilaUsuarioSql extends Omit<UsuarioFila, 'bloqueada'> {
  bloqueada: number | boolean;
}

const aUsuario = (fila: FilaUsuarioSql): UsuarioFila => ({ ...fila, activo: Boolean(fila.activo), bloqueada: Boolean(fila.bloqueada) });

/** Error 2627/2601 de SQL Server: se violó una restricción UNIQUE. */
function esViolacionUnica(error: unknown): boolean {
  const numero = typeof error === 'object' && error !== null ? (error as { number?: number }).number : undefined;
  return numero === 2627 || numero === 2601;
}

// Todo valor variable viaja como parámetro tipado; el texto SQL es fijo (sin posibilidad de inyección).
const SQL_CREAR_USUARIO = `
  INSERT INTO dbo.usuario (nombres, apellidos, correo, hash_contrasena)
  OUTPUT inserted.id_usuario, inserted.nombres, inserted.apellidos, inserted.correo, inserted.hash_contrasena,
         inserted.rol, inserted.activo, inserted.fecha_registro, CAST(0 AS BIT) AS bloqueada
  VALUES (@nombres, @apellidos, @correo, @hash);`;

const SQL_POR_CORREO = `SELECT ${COLUMNAS_USUARIO} FROM dbo.usuario WHERE correo = @correo;`;
const SQL_POR_ID = `SELECT ${COLUMNAS_USUARIO} FROM dbo.usuario WHERE id_usuario = @id;`;

// El contador se reinicia si el bloqueo anterior ya venció, de modo que un solo error tras el bloqueo no lo
// reactiva. Todas las expresiones del SET usan los valores previos de la fila, por eso `n.intentos` se calcula aparte.
const SQL_INTENTO_FALLIDO = `
  UPDATE u
     SET intentos_fallidos = n.intentos,
         bloqueado_hasta = CASE WHEN n.intentos >= @maximo THEN DATEADD(MINUTE, @minutos, SYSUTCDATETIME()) ELSE NULL END
    FROM dbo.usuario AS u
   CROSS APPLY (SELECT CASE
                         WHEN u.bloqueado_hasta IS NOT NULL AND u.bloqueado_hasta <= SYSUTCDATETIME() THEN 1
                         WHEN u.intentos_fallidos < 250 THEN u.intentos_fallidos + 1
                         ELSE 250
                       END AS intentos) AS n
   WHERE u.id_usuario = @id;`;

const SQL_ACCESO_EXITOSO = `
  UPDATE dbo.usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = SYSUTCDATETIME()
   WHERE id_usuario = @id AND activo = 1 AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= SYSUTCDATETIME());`;

const SQL_CREAR_SESION = `
  INSERT INTO dbo.sesion (id_usuario, hash_token_refresco, fecha_expiracion)
  VALUES (@id, @hash, DATEADD(DAY, @dias, SYSUTCDATETIME()));`;

const SQL_BUSCAR_SESION = `
  SELECT id_sesion, id_usuario,
         CASE WHEN fecha_revocacion IS NOT NULL THEN 1 ELSE 0 END AS revocada,
         CASE WHEN fecha_expiracion > SYSUTCDATETIME() THEN 1 ELSE 0 END AS vigente
    FROM dbo.sesion WHERE hash_token_refresco = @hash;`;

const SQL_REVOCAR_ACTUAL = `
  UPDATE dbo.sesion SET fecha_revocacion = SYSUTCDATETIME()
   WHERE id_sesion = @id AND fecha_revocacion IS NULL AND fecha_expiracion > SYSUTCDATETIME();`;

const SQL_REVOCAR_POR_HASH = `
  UPDATE dbo.sesion SET fecha_revocacion = SYSUTCDATETIME() WHERE hash_token_refresco = @hash AND fecha_revocacion IS NULL;`;

const SQL_REVOCAR_DE_USUARIO = `
  UPDATE dbo.sesion SET fecha_revocacion = SYSUTCDATETIME() WHERE id_usuario = @id AND fecha_revocacion IS NULL;`;

export function crearRepositorioCuentas(conexion: Conexion): RepositorioCuentas {
  return {
    async crearUsuario(datos) {
      try {
        const resultado = await (await conexion.pool())
          .request()
          .input('nombres', sql.NVarChar(80), datos.nombres)
          .input('apellidos', sql.NVarChar(80), datos.apellidos)
          .input('correo', sql.NVarChar(254), datos.correo)
          .input('hash', sql.VarChar(255), datos.hashContrasena)
          .query<FilaUsuarioSql>(SQL_CREAR_USUARIO);
        return aUsuario(resultado.recordset[0] as FilaUsuarioSql);
      } catch (error) {
        if (esViolacionUnica(error)) {
          throw new ErrorAplicacion(409, 'CORREO_YA_REGISTRADO', 'Ya existe una cuenta con ese correo.');
        }
        throw error;
      }
    },

    async buscarPorCorreo(correo) {
      const resultado = await (await conexion.pool()).request().input('correo', sql.NVarChar(254), correo).query<FilaUsuarioSql>(SQL_POR_CORREO);
      const fila = resultado.recordset[0];
      return fila ? aUsuario(fila) : null;
    },

    async buscarPorId(idUsuario) {
      const resultado = await (await conexion.pool()).request().input('id', sql.Int, idUsuario).query<FilaUsuarioSql>(SQL_POR_ID);
      const fila = resultado.recordset[0];
      return fila ? aUsuario(fila) : null;
    },

    async registrarIntentoFallido(idUsuario, maximoIntentos, minutosBloqueo) {
      await (await conexion.pool())
        .request()
        .input('id', sql.Int, idUsuario)
        .input('maximo', sql.Int, maximoIntentos)
        .input('minutos', sql.Int, minutosBloqueo)
        .query(SQL_INTENTO_FALLIDO);
    },

    async registrarAccesoExitoso(idUsuario) {
      const resultado = await (await conexion.pool()).request().input('id', sql.Int, idUsuario).query(SQL_ACCESO_EXITOSO);
      return resultado.rowsAffected[0] === 1;
    },

    async crearSesion(idUsuario, hashToken, diasVigencia) {
      await (await conexion.pool())
        .request()
        .input('id', sql.Int, idUsuario)
        .input('hash', sql.Char(64), hashToken)
        .input('dias', sql.Int, diasVigencia)
        .query(SQL_CREAR_SESION);
    },

    async buscarSesion(hashToken) {
      const resultado = await (await conexion.pool())
        .request()
        .input('hash', sql.Char(64), hashToken)
        .query<{ id_sesion: number; id_usuario: number; revocada: number; vigente: number }>(SQL_BUSCAR_SESION);
      const fila = resultado.recordset[0];
      return fila ? { ...fila, revocada: Boolean(fila.revocada), vigente: Boolean(fila.vigente) } : null;
    },

    async rotarSesion(idSesionActual, idUsuario, hashNuevo, diasVigencia) {
      return conexion.conTransaccion(async (transaccion) => {
        const revocada = await transaccion.request().input('id', sql.BigInt, idSesionActual).query(SQL_REVOCAR_ACTUAL);
        if (revocada.rowsAffected[0] !== 1) {
          return false;
        }
        await transaccion
          .request()
          .input('id', sql.Int, idUsuario)
          .input('hash', sql.Char(64), hashNuevo)
          .input('dias', sql.Int, diasVigencia)
          .query(SQL_CREAR_SESION);
        return true;
      });
    },

    async revocarSesion(hashToken) {
      await (await conexion.pool()).request().input('hash', sql.Char(64), hashToken).query(SQL_REVOCAR_POR_HASH);
    },

    async revocarSesionesDeUsuario(idUsuario) {
      await (await conexion.pool()).request().input('id', sql.Int, idUsuario).query(SQL_REVOCAR_DE_USUARIO);
    },
  };
}
