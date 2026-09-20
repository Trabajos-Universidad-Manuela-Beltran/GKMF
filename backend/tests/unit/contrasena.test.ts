import { describe, expect, it } from 'vitest';
import { hashearContrasena, verificarContrasena } from '../../src/seguridad/contrasena.js';

describe('contraseñas con scrypt', () => {
  it('genera un hash con formato, sal y longitud compatibles con la columna hash_contrasena', async () => {
    const hash = await hashearContrasena('Clave-Segura-2026');
    expect(hash).toMatch(/^scrypt\$65536\$8\$2\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(hash.length).toBeGreaterThanOrEqual(32); // CK_usuario_hash_longitud
    expect(hash.length).toBeLessThanOrEqual(255); // VARCHAR(255)
    expect(hash).not.toContain('Clave-Segura-2026');
  });

  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const hash = await hashearContrasena('Clave-Segura-2026');
    expect(await verificarContrasena('Clave-Segura-2026', hash)).toBe(true);
    expect(await verificarContrasena('clave-segura-2026', hash)).toBe(false);
    expect(await verificarContrasena('', hash)).toBe(false);
  });

  it('usa una sal distinta cada vez: la misma clave no produce el mismo hash', async () => {
    const [primero, segundo] = await Promise.all([hashearContrasena('misma-clave-123'), hashearContrasena('misma-clave-123')]);
    expect(primero).not.toBe(segundo);
    expect(await verificarContrasena('misma-clave-123', primero)).toBe(true);
    expect(await verificarContrasena('misma-clave-123', segundo)).toBe(true);
  });

  it('rechaza un hash alterado', async () => {
    const hash = await hashearContrasena('Clave-Segura-2026');
    const partes = hash.split('$');
    partes[5] = Buffer.alloc(64, 1).toString('base64');
    expect(await verificarContrasena('Clave-Segura-2026', partes.join('$'))).toBe(false);
  });

  it.each([
    ['vacío', ''],
    ['sin formato', 'no-es-un-hash'],
    ['algoritmo distinto', 'bcrypt$65536$8$2$c2FsdA==$aGFzaA=='],
    ['faltan partes', 'scrypt$65536$8$2$c2FsdA=='],
    ['costo excesivo (agotaría la memoria)', 'scrypt$1073741824$8$2$c2FsdA==$aGFzaA=='],
    ['parámetros no numéricos', 'scrypt$x$8$2$c2FsdA==$aGFzaA=='],
    ['el marcador de los datos de prueba', '!SIN_CLAVE_DEFINIDA!ESTABLECER_DESDE_EL_BACKEND_EN_LA_FASE_III'],
  ])('devuelve false (sin lanzar) ante un hash mal formado: %s', async (_motivo, almacenado) => {
    expect(await verificarContrasena('Clave-Segura-2026', almacenado)).toBe(false);
  });

  it('acota el largo de la contraseña para evitar abusos de CPU', async () => {
    await expect(hashearContrasena('')).rejects.toThrow(RangeError);
    await expect(hashearContrasena('x'.repeat(129))).rejects.toThrow(RangeError);
    const hash = await hashearContrasena('Clave-Segura-2026');
    expect(await verificarContrasena('x'.repeat(129), hash)).toBe(false);
  });
});
