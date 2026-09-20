import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { crearServicioTokens } from '../../src/seguridad/tokens.js';
import { crearEntornoPrueba } from './apoyo.js';

const entorno = crearEntornoPrueba();
const tokens = crearServicioTokens(entorno);
const clave = new TextEncoder().encode(entorno.JWT_SECRET);

/** Firma un token a mano para simular tokens defectuosos o hostiles. */
async function firmar(opciones: { alg?: string; sub?: string; rol?: string; exp?: number; iss?: string; aud?: string; secreto?: string }) {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ rol: opciones.rol ?? 'USUARIO' })
    .setProtectedHeader({ alg: opciones.alg ?? 'HS256' })
    .setSubject(opciones.sub ?? '7')
    .setIssuer(opciones.iss ?? entorno.JWT_ISSUER)
    .setAudience(opciones.aud ?? entorno.JWT_AUDIENCE)
    .setIssuedAt(ahora)
    .setExpirationTime(opciones.exp ?? ahora + 300)
    .sign(opciones.secreto ? new TextEncoder().encode(opciones.secreto) : clave);
}

describe('tokens de acceso JWT', () => {
  it('emite y verifica un token con la identidad del usuario', async () => {
    const token = await tokens.emitir({ idUsuario: 42, rol: 'ADMINISTRADOR' });
    expect(token.split('.')).toHaveLength(3);
    expect(await tokens.verificar(token)).toEqual({ idUsuario: 42, rol: 'ADMINISTRADOR' });
  });

  it('cada token lleva un identificador único (jti)', async () => {
    const [a, b] = await Promise.all([tokens.emitir({ idUsuario: 1, rol: 'USUARIO' }), tokens.emitir({ idUsuario: 1, rol: 'USUARIO' })]);
    expect(a).not.toBe(b);
  });

  it('acepta un token firmado a mano con los mismos datos (control de la prueba)', async () => {
    expect(await tokens.verificar(await firmar({}))).toEqual({ idUsuario: 7, rol: 'USUARIO' });
  });

  it('rechaza un token expirado', async () => {
    const expirado = await firmar({ exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(tokens.verificar(expirado)).rejects.toThrow();
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const ajeno = await firmar({ secreto: 'otro-secreto-completamente-distinto-1234567890' });
    await expect(tokens.verificar(ajeno)).rejects.toThrow();
  });

  it('rechaza un algoritmo distinto de HS256 (confusión de algoritmos)', async () => {
    await expect(tokens.verificar(await firmar({ alg: 'HS512' }))).rejects.toThrow();
  });

  it('rechaza un token con emisor o audiencia incorrectos', async () => {
    await expect(tokens.verificar(await firmar({ iss: 'otro-emisor' }))).rejects.toThrow();
    await expect(tokens.verificar(await firmar({ aud: 'otra-audiencia' }))).rejects.toThrow();
  });

  it('rechaza un rol desconocido o un sujeto que no es un id de usuario', async () => {
    await expect(tokens.verificar(await firmar({ rol: 'SUPERUSUARIO' }))).rejects.toThrow();
    await expect(tokens.verificar(await firmar({ sub: 'abc' }))).rejects.toThrow();
    await expect(tokens.verificar(await firmar({ sub: '0' }))).rejects.toThrow();
  });

  it('rechaza un token manipulado: el contenido falso es válido en todo salvo en su firma', async () => {
    const token = await tokens.emitir({ idUsuario: 1, rol: 'USUARIO' });
    const [cabecera, carga, firma] = token.split('.');
    const original = JSON.parse(Buffer.from(carga ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    // Se conservan emisor, audiencia y expiración originales: solo cambia el rol. Únicamente la firma puede delatarlo.
    const cargaFalsa = Buffer.from(JSON.stringify({ ...original, rol: 'ADMINISTRADOR' })).toString('base64url');
    await expect(tokens.verificar(`${cabecera}.${cargaFalsa}.${firma}`)).rejects.toMatchObject({
      code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    });
  });
});
