import { z } from 'zod';

// Nombres y apellidos: solo letras (con sus marcas de acento), espacios, apostrofes, puntos y guiones. Excluye "<", ">",
// comillas, controles y similares: defensa en profundidad contra texto hostil que luego se muestre en otra pantalla.
const FORMATO_NOMBRE = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;

const nombre = z
  .string({ error: 'es obligatorio' })
  .trim()
  .min(1, 'es obligatorio')
  .max(80, 'no puede superar 80 caracteres')
  .regex(FORMATO_NOMBRE, 'solo admite letras, espacios, apóstrofes, puntos y guiones');

const correo = z
  .string({ error: 'es obligatorio' })
  .trim()
  .toLowerCase()
  .max(254, 'no puede superar 254 caracteres')
  .pipe(z.email('no tiene un formato de correo válido'));

export const LONGITUD_MINIMA_CONTRASENA = 12;
export const LONGITUD_MAXIMA_CONTRASENA = 128;

// Contraseña nueva: largo antes que complejidad (NIST SP 800-63B). El máximo acota el trabajo de scrypt por solicitud.
// Se normaliza a NFKC antes de medir: doce caracteres combinados no pueden contar como doce si valen seis, ni una
// secuencia que se expande puede exceder el máximo que acepta el hash.
const contrasenaNueva = z
  .string({ error: 'es obligatoria' })
  .transform((texto) => texto.normalize('NFKC'))
  .pipe(
    z
      .string()
      .min(LONGITUD_MINIMA_CONTRASENA, `debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres`)
      .max(LONGITUD_MAXIMA_CONTRASENA, `no puede superar ${LONGITUD_MAXIMA_CONTRASENA} caracteres`),
  );

// Al iniciar sesión no se revela la política: solo se acota el largo para no gastar CPU con entradas gigantes.
const contrasenaActual = z
  .string({ error: 'es obligatoria' })
  .min(1, 'es obligatoria')
  .max(LONGITUD_MAXIMA_CONTRASENA, `no puede superar ${LONGITUD_MAXIMA_CONTRASENA} caracteres`);

// 32 bytes en base64url = 43 caracteres (ver generarTokenRefresco).
const tokenRefresco = z.string({ error: 'es obligatorio' }).regex(/^[A-Za-z0-9_-]{43}$/, 'tiene un formato inválido');

export const cuerpoRegistro = z.strictObject({
  nombres: nombre,
  apellidos: nombre,
  correo,
  contrasena: contrasenaNueva,
});

export const cuerpoLogin = z.strictObject({
  correo,
  contrasena: contrasenaActual,
});

export const cuerpoRefresco = z.strictObject({ tokenRefresco });

export type CuerpoRegistro = z.output<typeof cuerpoRegistro>;
export type CuerpoLogin = z.output<typeof cuerpoLogin>;
export type CuerpoRefresco = z.output<typeof cuerpoRefresco>;
