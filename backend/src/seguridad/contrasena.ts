import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Hash de contraseñas con scrypt (función de derivación con costo de memoria, resistente
 * a ataques con GPU). Parámetros N=2^16, r=8, p=2, equivalentes a los mínimos de OWASP
 * Password Storage Cheat Sheet. Formato almacenado en usuario.hash_contrasena:
 *   scrypt$N$r$p$sal_base64$hash_base64
 * La sal es aleatoria y única por contraseña, de modo que dos usuarios con la misma
 * clave no comparten hash.
 */
const COSTO_N = 2 ** 16;
const BLOQUE_R = 8;
const PARALELISMO_P = 2;
const LONGITUD_SAL = 16;
const LONGITUD_HASH = 64;
const MEMORIA_MAXIMA = 128 * 1024 * 1024;
const LONGITUD_MAXIMA_CLAVE = 128; // acota el trabajo que puede exigir una sola solicitud

function derivar(clave: string, sal: Buffer, n: number, r: number, p: number, longitud: number): Promise<Buffer> {
  const opciones: ScryptOptions = { N: n, r, p, maxmem: MEMORIA_MAXIMA };
  return new Promise((resolver, rechazar) => {
    scrypt(clave, sal, longitud, opciones, (error, resultado) => {
      if (error) {
        rechazar(error);
      } else {
        resolver(resultado);
      }
    });
  });
}

export async function hashearContrasena(clave: string): Promise<string> {
  if (clave.length === 0 || clave.length > LONGITUD_MAXIMA_CLAVE) {
    throw new RangeError(`La contraseña debe tener entre 1 y ${LONGITUD_MAXIMA_CLAVE} caracteres.`);
  }
  const sal = randomBytes(LONGITUD_SAL);
  const hash = await derivar(clave, sal, COSTO_N, BLOQUE_R, PARALELISMO_P, LONGITUD_HASH);
  return ['scrypt', COSTO_N, BLOQUE_R, PARALELISMO_P, sal.toString('base64'), hash.toString('base64')].join('$');
}

/** Compara una contraseña con un hash almacenado en tiempo constante. Nunca lanza por hashes mal formados. */
export async function verificarContrasena(clave: string, almacenado: string): Promise<boolean> {
  if (clave.length === 0 || clave.length > LONGITUD_MAXIMA_CLAVE) {
    return false;
  }
  const partes = almacenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') {
    return false;
  }
  const [, textoN, textoR, textoP, textoSal, textoHash] = partes;
  const n = Number(textoN);
  const r = Number(textoR);
  const p = Number(textoP);
  // Se acotan los parámetros leídos del hash para que un valor manipulado no pueda exigir memoria o CPU ilimitadas.
  const parametrosValidos = [n, r, p].every((valor) => Number.isInteger(valor) && valor > 0) && n <= COSTO_N && r <= 32 && p <= 16;
  if (!parametrosValidos || !textoSal || !textoHash) {
    return false;
  }
  const sal = Buffer.from(textoSal, 'base64');
  const esperado = Buffer.from(textoHash, 'base64');
  if (sal.length === 0 || esperado.length === 0) {
    return false;
  }
  try {
    const calculado = await derivar(clave, sal, n, r, p, esperado.length);
    return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}
