/**
 * Emite un token de acceso de DESARROLLO para probar la API con curl o Postman
 * mientras no exista el inicio de sesión (Fase III).
 *
 *   npm run token:dev              -> token del usuario 1 (rol USUARIO)
 *   npm run token:dev -- 3 ADMINISTRADOR
 *
 * Usa el mismo JWT_SECRET del .env. Se niega a ejecutarse con NODE_ENV=production.
 */
import { cargarEntorno } from '../src/config/entorno.js';
import { crearServicioTokens, type Rol } from '../src/seguridad/tokens.js';

const entorno = cargarEntorno();
if (entorno.NODE_ENV === 'production') {
  console.error('token:dev no está permitido con NODE_ENV=production.');
  process.exit(1);
}

const [argumentoId = '1', argumentoRol = 'USUARIO'] = process.argv.slice(2);
const idUsuario = Number(argumentoId);
if (!Number.isInteger(idUsuario) || idUsuario < 1) {
  console.error('El id de usuario debe ser un entero positivo.');
  process.exit(1);
}
if (argumentoRol !== 'USUARIO' && argumentoRol !== 'ADMINISTRADOR') {
  console.error('El rol debe ser USUARIO o ADMINISTRADOR.');
  process.exit(1);
}

const rol: Rol = argumentoRol;
console.log(await crearServicioTokens(entorno).emitir({ idUsuario, rol }));
