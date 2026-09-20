import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { crearLogger } from '../../src/utilidades/logger.js';

function capturar() {
  const lineas: string[] = [];
  const destino = new Writable({
    write(fragmento, _codificacion, listo) {
      lineas.push(fragmento.toString());
      listo();
    },
  });
  return { lineas, destino };
}

describe('registro estructurado', () => {
  it('redacta secretos en el nivel superior, anidados y en variantes de nombre', () => {
    const { lineas, destino } = capturar();
    const logger = crearLogger({ LOG_LEVEL: 'info' }, destino);

    logger.info(
      {
        password: 'SECRETO-1',
        token: 'SECRETO-2',
        body: { usuario: { password: 'SECRETO-3' } },
        req: { headers: { authorization: 'Bearer SECRETO-4', cookie: 'sid=SECRETO-5' } },
        accessToken: 'SECRETO-6',
        refresh_token: 'SECRETO-7',
        datos: { hash_contrasena: 'SECRETO-8', clave: 'SECRETO-9' },
      },
      'prueba de redacción',
    );

    const salida = lineas.join('');
    for (let i = 1; i <= 9; i += 1) {
      expect(salida).not.toContain(`SECRETO-${i}`);
    }
    expect(salida).toContain('[REDACTADO]');
    expect(salida).toContain('prueba de redacción'); // el mensaje sí se conserva
  });

  it('respeta el nivel configurado', () => {
    const { lineas, destino } = capturar();
    const logger = crearLogger({ LOG_LEVEL: 'warn' }, destino);
    logger.info('no debe aparecer');
    logger.warn('sí debe aparecer');
    expect(lineas.join('')).not.toContain('no debe aparecer');
    expect(lineas.join('')).toContain('sí debe aparecer');
  });
});
