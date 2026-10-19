import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { ErrorAplicacion } from '../../src/middlewares/errores.js';
import type { ServicioCuentas } from '../../src/modulos/cuentas/cuentas.servicio.js';
import { crearServicioTokens } from '../../src/seguridad/tokens.js';
import { crearLogger } from '../../src/utilidades/logger.js';
import { crearEntornoPrueba, crearServicioCuentasFalso, crearServicioMetasFalso, USUARIO_PRUEBA } from './apoyo.js';

function crearAppPrueba(extra: Record<string, string> = {}, servicioCuentas: ServicioCuentas = crearServicioCuentasFalso()) {
  const entorno = crearEntornoPrueba(extra);
  const tokens = crearServicioTokens(entorno);
  const app = crearApp({
    entorno,
    logger: crearLogger(entorno),
    verificarBaseDeDatos: async () => true,
    verificarToken: (token) => tokens.verificar(token),
    servicioEducacion: { listarCategorias: vi.fn(), listarLecciones: vi.fn() },
    servicioCuentas,
    servicioMetas: crearServicioMetasFalso(),
  });
  return { app, servicioCuentas };
}

const registroValido = { nombres: 'Ana María', apellidos: "O'Brien-Pérez", correo: 'Ana@Example.com', contrasena: 'una-clave-larga-123' };
const TOKEN_REFRESCO = 'R'.repeat(43);

describe('POST /api/v1/auth/registro', () => {
  it('crea la cuenta sin exigir autenticación y responde 201 sin datos sensibles', async () => {
    const { app, servicioCuentas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/auth/registro').send(registroValido);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toEqual({ exito: true, datos: USUARIO_PRUEBA });
    expect(JSON.stringify(respuesta.body)).not.toMatch(/contrasena|hash/i);
    // El correo llega ya normalizado (minúsculas y sin espacios) al servicio.
    expect(servicioCuentas.registrar).toHaveBeenCalledWith({ ...registroValido, correo: 'ana@example.com' });
  });

  it.each([
    ['contraseña corta', { ...registroValido, contrasena: 'corta-123' }],
    ['contraseña demasiado larga', { ...registroValido, contrasena: 'x'.repeat(129) }],
    ['correo inválido', { ...registroValido, correo: 'no-es-un-correo' }],
    ['nombre con marcado HTML', { ...registroValido, nombres: '<script>alert(1)</script>' }],
    ['nombre vacío', { ...registroValido, nombres: '   ' }],
    ['campo no permitido (intento de asignar el rol)', { ...registroValido, rol: 'ADMINISTRADOR' }],
    ['12 caracteres que normalizan a 6 (e + tilde combinada)', { ...registroValido, contrasena: 'e\u0301'.repeat(6) }],
    ['una secuencia que al normalizar excede 128 caracteres', { ...registroValido, contrasena: '\uFDFA'.repeat(12) }],
    ['falta la contraseña', { nombres: 'A', apellidos: 'B', correo: 'a@b.co' }],
  ])('rechaza con 400 y sin llamar al servicio: %s', async (_caso, cuerpo) => {
    const { app, servicioCuentas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/auth/registro').send(cuerpo);
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('DATOS_INVALIDOS');
    expect(servicioCuentas.registrar).not.toHaveBeenCalled();
  });

  it('nunca refleja en el error el valor enviado (ni la contraseña)', async () => {
    const { app } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/auth/registro').send({ ...registroValido, contrasena: 'secreta-corta' });
    expect(JSON.stringify(respuesta.body)).not.toContain('secreta-corta');
  });

  it('traduce el 409 de correo duplicado', async () => {
    const servicio = crearServicioCuentasFalso();
    vi.mocked(servicio.registrar).mockRejectedValueOnce(new ErrorAplicacion(409, 'CORREO_YA_REGISTRADO', 'Ya existe una cuenta con ese correo.'));
    const { app } = crearAppPrueba({}, servicio);
    const respuesta = await request(app).post('/api/v1/auth/registro').send(registroValido);
    expect(respuesta.status).toBe(409);
    expect(respuesta.body.error.codigo).toBe('CORREO_YA_REGISTRADO');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('devuelve los tokens y el usuario', async () => {
    const { app, servicioCuentas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/auth/login').send({ correo: ' ANA@example.com ', contrasena: 'una-clave-larga-123' });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.datos).toMatchObject({ tipoToken: 'Bearer', expiraEnSegundos: 900, usuario: { id: 7 } });
    expect(respuesta.body.datos.tokenAcceso).toBeTruthy();
    expect(servicioCuentas.iniciarSesion).toHaveBeenCalledWith({ correo: 'ana@example.com', contrasena: 'una-clave-larga-123' });
  });

  it('no exige la política de contraseñas al iniciar sesión (no la revela)', async () => {
    const { app, servicioCuentas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/auth/login').send({ correo: 'ana@example.com', contrasena: 'corta' });
    expect(respuesta.status).toBe(200);
    expect(servicioCuentas.iniciarSesion).toHaveBeenCalled();
  });

  it('traduce el 401 genérico de credenciales inválidas con el encabezado WWW-Authenticate', async () => {
    const servicio = crearServicioCuentasFalso();
    vi.mocked(servicio.iniciarSesion).mockRejectedValueOnce(new ErrorAplicacion(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.'));
    const { app } = crearAppPrueba({}, servicio);
    const respuesta = await request(app).post('/api/v1/auth/login').send({ correo: 'ana@example.com', contrasena: 'mala' });
    expect(respuesta.status).toBe(401);
    expect(respuesta.headers['www-authenticate']).toBe('Bearer');
    expect(respuesta.body.error.codigo).toBe('CREDENCIALES_INVALIDAS');
  });

  it('rechaza campos de más y entradas gigantes', async () => {
    const { app } = crearAppPrueba();
    expect((await request(app).post('/api/v1/auth/login').send({ correo: 'ana@example.com', contrasena: 'x', admin: true })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/login').send({ correo: 'ana@example.com', contrasena: 'x'.repeat(5000) })).status).toBe(400);
  });
});

describe('POST /api/v1/auth/refresco y /cierre', () => {
  it('renueva los tokens', async () => {
    const { app, servicioCuentas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/auth/refresco').send({ tokenRefresco: TOKEN_REFRESCO });
    expect(respuesta.status).toBe(200);
    expect(servicioCuentas.renovar).toHaveBeenCalledWith(TOKEN_REFRESCO);
  });

  it('cierra la sesión con 204 y sin cuerpo', async () => {
    const { app, servicioCuentas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/auth/cierre').send({ tokenRefresco: TOKEN_REFRESCO });
    expect(respuesta.status).toBe(204);
    expect(respuesta.text).toBe('');
    expect(servicioCuentas.cerrarSesion).toHaveBeenCalledWith(TOKEN_REFRESCO);
  });

  it.each(['/refresco', '/cierre'])('%s rechaza un token con formato inválido sin llegar al servicio', async (ruta) => {
    const { app, servicioCuentas } = crearAppPrueba();
    const respuesta = await request(app).post(`/api/v1/auth${ruta}`).send({ tokenRefresco: "' OR 1=1 --" });
    expect(respuesta.status).toBe(400);
    expect(servicioCuentas.renovar).not.toHaveBeenCalled();
    expect(servicioCuentas.cerrarSesion).not.toHaveBeenCalled();
  });
});

describe('límite de solicitudes de autenticación', () => {
  it('responde 429 al superar el máximo configurado, aunque el limitador general no se haya agotado', async () => {
    const { app } = crearAppPrueba({ AUTH_RATE_LIMIT_MAX: '3' });
    const intento = () => request(app).post('/api/v1/auth/login').send({ correo: 'ana@example.com', contrasena: 'x' });

    for (let i = 0; i < 3; i += 1) {
      expect((await intento()).status).toBe(200);
    }
    const bloqueada = await intento();
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body.error.codigo).toBe('DEMASIADOS_INTENTOS');
  });

  it('el límite de autenticación no afecta a las rutas autenticadas ni a las sondas de salud', async () => {
    const { app } = crearAppPrueba({ AUTH_RATE_LIMIT_MAX: '1' });
    await request(app).post('/api/v1/auth/login').send({ correo: 'ana@example.com', contrasena: 'x' });
    expect((await request(app).post('/api/v1/auth/login').send({ correo: 'ana@example.com', contrasena: 'x' })).status).toBe(429);
    expect((await request(app).get('/api/v1/salud')).status).toBe(200);
  });
});

describe('denegación por defecto', () => {
  it('solo salud y auth son públicas: metas y movimientos exigen token', async () => {
    const { app } = crearAppPrueba();
    for (const ruta of ['/api/v1/metas', '/api/v1/metas/1', '/api/v1/movimientos', '/api/v1/educacion/categorias']) {
      expect((await request(app).get(ruta)).status, ruta).toBe(401);
    }
    expect((await request(app).post('/api/v1/metas').send({})).status).toBe(401);
  });
});
