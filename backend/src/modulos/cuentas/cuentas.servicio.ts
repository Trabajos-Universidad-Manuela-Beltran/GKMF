import { createHash, randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import { ErrorAplicacion } from '../../middlewares/errores.js';
import { hashearContrasena, verificarContrasena } from '../../seguridad/contrasena.js';
import { crearLimitadorConcurrencia, type Limitador } from '../../seguridad/limitador.js';
import type { Rol, ServicioTokens } from '../../seguridad/tokens.js';
import type { RepositorioCuentas, UsuarioFila } from './cuentas.repositorio.js';

export interface UsuarioPublico {
  id: number;
  nombres: string;
  apellidos: string;
  correo: string;
  rol: Rol;
  fechaRegistro: string;
}

export interface TokensEmitidos {
  tokenAcceso: string;
  tokenRefresco: string;
  tipoToken: 'Bearer';
  expiraEnSegundos: number;
}

export interface SesionIniciada extends TokensEmitidos {
  usuario: UsuarioPublico;
}

export interface DatosRegistro {
  nombres: string;
  apellidos: string;
  correo: string;
  contrasena: string;
}

export interface Credenciales {
  correo: string;
  contrasena: string;
}

export interface ServicioCuentas {
  registrar(datos: DatosRegistro): Promise<UsuarioPublico>;
  iniciarSesion(credenciales: Credenciales): Promise<SesionIniciada>;
  renovar(tokenRefresco: string): Promise<TokensEmitidos>;
  cerrarSesion(tokenRefresco: string): Promise<void>;
}

export interface DependenciasServicioCuentas {
  repositorio: RepositorioCuentas;
  tokens: Pick<ServicioTokens, 'emitir'>;
  config: {
    REFRESH_TTL_DAYS: number;
    LOGIN_MAX_ATTEMPTS: number;
    LOGIN_LOCK_MINUTES: number;
    JWT_ACCESS_TTL_SECONDS: number;
  };
  /** Funciones de hash; se pueden reemplazar en las pruebas (el scrypt real tarda cientos de milisegundos). */
  hash?: {
    hashear: (clave: string) => Promise<string>;
    verificar: (clave: string, almacenado: string) => Promise<boolean>;
  };
  /** Tope de hashes simultáneos; por defecto 2 a la vez y 50 en cola. */
  limitar?: Limitador;
  logger?: Pick<Logger, 'warn'>;
}

/** El token de refresco es opaco: 32 bytes aleatorios (256 bits) en base64url, 43 caracteres. */
const BYTES_TOKEN_REFRESCO = 32;

const generarTokenRefresco = (): string => randomBytes(BYTES_TOKEN_REFRESCO).toString('base64url');
/** En la base solo se guarda el SHA-256 del token: una filtración de la tabla no permite usar las sesiones. */
const hashearToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const aUsuarioPublico = (fila: UsuarioFila): UsuarioPublico => ({
  id: fila.id_usuario,
  nombres: fila.nombres,
  apellidos: fila.apellidos,
  correo: fila.correo,
  rol: fila.rol,
  fechaRegistro: fila.fecha_registro.toISOString(),
});

/** Mismo error para correo inexistente, contraseña incorrecta, cuenta bloqueada o desactivada: no revela cuál ocurrió. */
const credencialesInvalidas = () =>
  new ErrorAplicacion(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos, o la cuenta está bloqueada temporalmente.');

const tokenRefrescoInvalido = () => new ErrorAplicacion(401, 'TOKEN_REFRESCO_INVALIDO', 'La sesión no es válida o ha expirado. Inicie sesión de nuevo.');

/** Casos de uso CU-01 (registrarse), CU-02 (iniciar sesión, con CU-17 y CU-18), CU-03 (cerrar sesión) y la renovación del token. */
export function crearServicioCuentas(dependencias: DependenciasServicioCuentas): ServicioCuentas {
  const { repositorio, tokens, config, logger } = dependencias;
  const hash = dependencias.hash ?? { hashear: hashearContrasena, verificar: verificarContrasena };
  const limitar = dependencias.limitar ?? crearLimitadorConcurrencia({ maximo: 2, maximoEnCola: 50 });

  // Hash de una clave aleatoria que nadie conoce: sirve para gastar el mismo tiempo cuando el correo no existe.
  let hashFicticio: Promise<string> | undefined;
  const obtenerHashFicticio = (): Promise<string> => {
    // Si el cálculo falla (cola llena, error de hash) no se conserva la promesa rechazada: el siguiente intento lo reintenta.
    hashFicticio ??= limitar(() => hash.hashear(randomBytes(16).toString('hex'))).catch((error: unknown) => {
      hashFicticio = undefined;
      throw error;
    });
    return hashFicticio;
  };

  /** NFKC: la misma contraseña escrita con otra composición Unicode (acentos, anchos) produce el mismo hash. */
  const normalizar = (clave: string): string => clave.normalize('NFKC');

  async function emitirTokens(usuario: UsuarioFila): Promise<TokensEmitidos> {
    const tokenRefresco = generarTokenRefresco();
    await repositorio.crearSesion(usuario.id_usuario, hashearToken(tokenRefresco), config.REFRESH_TTL_DAYS);
    return {
      tokenAcceso: await tokens.emitir({ idUsuario: usuario.id_usuario, rol: usuario.rol }),
      tokenRefresco,
      tipoToken: 'Bearer',
      expiraEnSegundos: config.JWT_ACCESS_TTL_SECONDS,
    };
  }

  return {
    async registrar(datos) {
      const hashContrasena = await limitar(() => hash.hashear(normalizar(datos.contrasena)));
      const creado = await repositorio.crearUsuario({
        nombres: datos.nombres,
        apellidos: datos.apellidos,
        correo: datos.correo.trim().toLowerCase(),
        hashContrasena,
      });
      return aUsuarioPublico(creado);
    },

    async iniciarSesion({ correo, contrasena }) {
      const usuario = await repositorio.buscarPorCorreo(correo.trim().toLowerCase());
      const clave = normalizar(contrasena);

      if (!usuario || !usuario.activo || usuario.bloqueada) {
        // Se hace el mismo trabajo que con un usuario real para que el tiempo de respuesta no delate si el correo existe.
        // El hash ficticio se obtiene FUERA del turno: pedirlo dentro, con el limitador lleno, provocaría un bloqueo mutuo.
        const ficticio = await obtenerHashFicticio();
        await limitar(() => hash.verificar(clave, ficticio));
        throw credencialesInvalidas();
      }

      const correcta = await limitar(() => hash.verificar(clave, usuario.hash_contrasena));
      if (!correcta) {
        await repositorio.registrarIntentoFallido(usuario.id_usuario, config.LOGIN_MAX_ATTEMPTS, config.LOGIN_LOCK_MINUTES);
        throw credencialesInvalidas();
      }

      // La comprobación de bloqueo y de cuenta activa se repite en la propia sentencia SQL: si la cuenta se bloqueó o se
      // desactivó entre la lectura y este punto (solicitudes simultáneas), no se abre la sesión.
      if (!(await repositorio.registrarAccesoExitoso(usuario.id_usuario))) {
        throw credencialesInvalidas();
      }
      return { ...(await emitirTokens(usuario)), usuario: aUsuarioPublico(usuario) };
    },

    async renovar(tokenRefresco) {
      const sesion = await repositorio.buscarSesion(hashearToken(tokenRefresco));
      if (!sesion) {
        throw tokenRefrescoInvalido();
      }

      // Un token ya revocado que vuelve a presentarse indica que alguien más lo copió: se cierran todas las sesiones.
      if (sesion.revocada) {
        logger?.warn({ idUsuario: sesion.id_usuario }, 'Reutilización de un token de refresco revocado: se revocan todas las sesiones');
        await repositorio.revocarSesionesDeUsuario(sesion.id_usuario);
        throw tokenRefrescoInvalido();
      }
      if (!sesion.vigente) {
        throw tokenRefrescoInvalido();
      }

      const usuario = await repositorio.buscarPorId(sesion.id_usuario);
      if (!usuario?.activo) {
        await repositorio.revocarSesionesDeUsuario(sesion.id_usuario);
        throw tokenRefrescoInvalido();
      }

      const nuevoToken = generarTokenRefresco();
      const rotada = await repositorio.rotarSesion(sesion.id_sesion, usuario.id_usuario, hashearToken(nuevoToken), config.REFRESH_TTL_DAYS);
      if (!rotada) {
        // Otra solicitud usó este mismo token un instante antes: solo una puede ganar, la otra es sospechosa.
        logger?.warn({ idUsuario: usuario.id_usuario }, 'Dos renovaciones simultáneas con el mismo token: se revocan todas las sesiones');
        await repositorio.revocarSesionesDeUsuario(usuario.id_usuario);
        throw tokenRefrescoInvalido();
      }

      return {
        tokenAcceso: await tokens.emitir({ idUsuario: usuario.id_usuario, rol: usuario.rol }),
        tokenRefresco: nuevoToken,
        tipoToken: 'Bearer',
        expiraEnSegundos: config.JWT_ACCESS_TTL_SECONDS,
      };
    },

    async cerrarSesion(tokenRefresco) {
      await repositorio.revocarSesion(hashearToken(tokenRefresco));
    },
  };
}
