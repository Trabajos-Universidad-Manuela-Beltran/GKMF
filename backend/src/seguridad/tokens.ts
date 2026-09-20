import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Entorno } from '../config/entorno.js';

export type Rol = 'USUARIO' | 'ADMINISTRADOR';

/** Usuario autenticado, tal como lo describe el token de acceso. */
export interface Identidad {
  idUsuario: number;
  rol: Rol;
}

const ALGORITMO = 'HS256';

// Contenido que un token válido debe traer; `sub` es el id_usuario en texto.
const esquemaClaims = z.object({
  sub: z.string().regex(/^[1-9]\d{0,9}$/),
  rol: z.enum(['USUARIO', 'ADMINISTRADOR']),
});

export interface ServicioTokens {
  emitir(identidad: Identidad): Promise<string>;
  verificar(token: string): Promise<Identidad>;
}

/**
 * Tokens de acceso JWT firmados con HS256. Se fija el algoritmo esperado (evita el
 * ataque "alg: none" y la confusión de algoritmos) y se exigen emisor, audiencia y
 * expiración. La vida corta del token (15 min por defecto) limita el daño de un robo;
 * la renovación se hará con tokens de refresco guardados como hash en `sesion`.
 */
export function crearServicioTokens(
  entorno: Pick<Entorno, 'JWT_SECRET' | 'JWT_ISSUER' | 'JWT_AUDIENCE' | 'JWT_ACCESS_TTL_SECONDS'>,
): ServicioTokens {
  const clave = new TextEncoder().encode(entorno.JWT_SECRET);

  return {
    async emitir(identidad) {
      const ahora = Math.floor(Date.now() / 1000);
      return new SignJWT({ rol: identidad.rol })
        .setProtectedHeader({ alg: ALGORITMO, typ: 'JWT' })
        .setSubject(String(identidad.idUsuario))
        .setIssuer(entorno.JWT_ISSUER)
        .setAudience(entorno.JWT_AUDIENCE)
        .setIssuedAt(ahora)
        .setExpirationTime(ahora + entorno.JWT_ACCESS_TTL_SECONDS)
        .setJti(randomUUID())
        .sign(clave);
    },

    async verificar(token) {
      const { payload } = await jwtVerify(token, clave, {
        algorithms: [ALGORITMO],
        issuer: entorno.JWT_ISSUER,
        audience: entorno.JWT_AUDIENCE,
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      const claims = esquemaClaims.parse(payload);
      return { idUsuario: Number(claims.sub), rol: claims.rol };
    },
  };
}
