import { describe, expect, it } from 'vitest';
import { cargarEntorno, ErrorConfiguracion } from '../../src/config/entorno.js';
import { VARIABLES_BASE, crearEntornoPrueba } from './apoyo.js';

describe('cargarEntorno', () => {
  it('aplica valores por defecto seguros', () => {
    const entorno = crearEntornoPrueba();
    expect(entorno.HOST).toBe('127.0.0.1');
    expect(entorno.PORT).toBe(3000);
    expect(entorno.DB_NAME).toBe('GKMF');
    expect(entorno.DB_ENCRYPT).toBe(true);
    expect(entorno.DB_TRUST_SERVER_CERTIFICATE).toBe(false);
    expect(entorno.CORS_ORIGINS).toEqual([]);
    expect(entorno.JWT_ACCESS_TTL_SECONDS).toBe(900);
  });

  it('convierte los textos a sus tipos', () => {
    const entorno = crearEntornoPrueba({
      PORT: '8080',
      DB_ENCRYPT: 'false',
      DB_TRUST_SERVER_CERTIFICATE: 'true',
      CORS_ORIGINS: 'https://a.example.com, https://b.example.com:8443',
    });
    expect(entorno.PORT).toBe(8080);
    expect(entorno.DB_ENCRYPT).toBe(false);
    expect(entorno.DB_TRUST_SERVER_CERTIFICATE).toBe(true);
    expect(entorno.CORS_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com:8443']);
  });

  it('falla si faltan variables obligatorias y lista sus nombres', () => {
    expect(() => cargarEntorno({})).toThrow(ErrorConfiguracion);
    try {
      cargarEntorno({});
    } catch (error) {
      const mensaje = (error as Error).message;
      for (const nombre of ['DB_SERVER', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET']) {
        expect(mensaje).toContain(nombre);
      }
    }
  });

  it('rechaza un secreto JWT corto y no revela su valor', () => {
    const secretoCorto = 'corto-123';
    try {
      cargarEntorno({ ...VARIABLES_BASE, JWT_SECRET: secretoCorto });
      expect.unreachable('debió lanzar ErrorConfiguracion');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorConfiguracion);
      expect((error as Error).message).toContain('JWT_SECRET');
      expect((error as Error).message).not.toContain(secretoCorto);
    }
  });

  it('rechaza puertos fuera de rango', () => {
    expect(() => crearEntornoPrueba({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => crearEntornoPrueba({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it.each(['*', 'https://app.example.com/', 'app.example.com', 'https://app.example.com/ruta'])(
    'rechaza el origen CORS no exacto "%s"',
    (origen) => {
      expect(() => crearEntornoPrueba({ CORS_ORIGINS: origen })).toThrow(/CORS_ORIGINS/);
    },
  );

  it('si se omite NODE_ENV asume producción (seguro por defecto)', () => {
    const { NODE_ENV: _omitido, ...sinEntorno } = VARIABLES_BASE;
    expect(cargarEntorno(sinEntorno).NODE_ENV).toBe('production');
    expect(() => cargarEntorno({ ...sinEntorno, DB_TRUST_SERVER_CERTIFICATE: 'true' })).toThrow(/DB_TRUST_SERVER_CERTIFICATE/);
  });

  describe('en producción', () => {
    it('exige que los orígenes CORS usen https', () => {
      expect(() => crearEntornoPrueba({ NODE_ENV: 'production', CORS_ORIGINS: 'http://app.example.com' })).toThrow(/CORS_ORIGINS/);
      expect(crearEntornoPrueba({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com' }).CORS_ORIGINS).toEqual([
        'https://app.example.com',
      ]);
    });

    it.each(['debug', 'trace'])('no permite el nivel de registro %s', (nivel) => {
      expect(() => crearEntornoPrueba({ NODE_ENV: 'production', LOG_LEVEL: nivel })).toThrow(/LOG_LEVEL/);
    });

    it('exige un secreto JWT robusto (largo y variado) y no revela su valor', () => {
      const debilRepetido = 'a'.repeat(60);
      const debilCorto = 'Solo-treinta-y-dos-caracteres-ok';
      expect(() => crearEntornoPrueba({ NODE_ENV: 'production', JWT_SECRET: debilRepetido })).toThrow(/JWT_SECRET/);
      expect(() => crearEntornoPrueba({ NODE_ENV: 'production', JWT_SECRET: debilCorto })).toThrow(/JWT_SECRET/);
      try {
        crearEntornoPrueba({ NODE_ENV: 'production', JWT_SECRET: debilCorto });
      } catch (error) {
        expect((error as Error).message).not.toContain(debilCorto);
      }
    });

    it('exige cifrado de la conexión a la base de datos', () => {
      expect(() => crearEntornoPrueba({ NODE_ENV: 'production', DB_ENCRYPT: 'false' })).toThrow(/DB_ENCRYPT/);
    });

    it('prohíbe confiar en certificados autofirmados', () => {
      expect(() => crearEntornoPrueba({ NODE_ENV: 'production', DB_TRUST_SERVER_CERTIFICATE: 'true' })).toThrow(
        /DB_TRUST_SERVER_CERTIFICATE/,
      );
    });

    it('acepta una configuración segura', () => {
      const entorno = crearEntornoPrueba({ NODE_ENV: 'production' });
      expect(entorno.NODE_ENV).toBe('production');
    });
  });
});
