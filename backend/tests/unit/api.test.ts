import type { Express } from 'express';
import { SignJWT } from 'jose';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp, type DependenciasApp } from '../../src/app.js';
import type { Entorno } from '../../src/config/entorno.js';
import { ErrorAplicacion } from '../../src/middlewares/errores.js';
import type { ServicioEducacion } from '../../src/modulos/educacion/educacion.servicio.js';
import { crearServicioTokens } from '../../src/seguridad/tokens.js';
import { crearLogger } from '../../src/utilidades/logger.js';
import { crearEntornoPrueba, crearServicioCuentasFalso, crearServicioMetasFalso } from './apoyo.js';

const ENTORNO_ORIGEN = 'https://app.gkmf.test';

function crearServicioFalso(): ServicioEducacion {
  return {
    listarCategorias: vi.fn(async () => [
      { id: 1, nombre: 'Ahorro', descripcion: 'Hábitos de ahorro', icono: 'candado', totalLecciones: 2 },
    ]),
    listarLecciones: vi.fn(async (idCategoria: number, pagina: number, limite: number) => {
      if (idCategoria === 99) {
        throw new ErrorAplicacion(404, 'CATEGORIA_NO_ENCONTRADA', 'La categoría solicitada no existe.');
      }
      return {
        lecciones: [{ id: 1, titulo: '¿Qué es el ahorro programado?', resumen: 'Resumen', duracionMinutos: 5, orden: 1, esDestacada: true }],
        paginacion: { pagina, limite, total: 1, totalPaginas: 1 },
      };
    }),
  };
}

function crearAppPrueba(
  sobrescribir: Partial<DependenciasApp> = {},
  entorno: Entorno = crearEntornoPrueba({ CORS_ORIGINS: ENTORNO_ORIGEN }),
): { app: Express; servicio: ServicioEducacion; entorno: Entorno } {
  const servicio = crearServicioFalso();
  const tokens = crearServicioTokens(entorno);
  const app = crearApp({
    entorno,
    logger: crearLogger(entorno),
    verificarBaseDeDatos: async () => true,
    verificarToken: (token) => tokens.verificar(token),
    servicioEducacion: servicio,
    servicioCuentas: crearServicioCuentasFalso(),
    servicioMetas: crearServicioMetasFalso(),
    ...sobrescribir,
  });
  return { app, servicio, entorno };
}

async function tokenValido(entorno: Entorno, rol: 'USUARIO' | 'ADMINISTRADOR' = 'USUARIO'): Promise<string> {
  return crearServicioTokens(entorno).emitir({ idUsuario: 1, rol });
}

describe('API - salud y cabeceras de seguridad', () => {
  it('GET /api/v1/salud responde 200 sin autenticación', async () => {
    const { app } = crearAppPrueba();
    const respuesta = await request(app).get('/api/v1/salud');
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ exito: true, datos: { estado: 'ok' } });
  });

  it('envía cabeceras de seguridad y no revela la tecnología del servidor', async () => {
    const { app } = crearAppPrueba();
    const { headers } = await request(app).get('/api/v1/salud');
    expect(headers['x-powered-by']).toBeUndefined();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['strict-transport-security']).toBeDefined();
    expect(headers['cache-control']).toBe('no-store');
  });

  it('GET /salud/listo responde 200 si la base de datos está disponible', async () => {
    const { app } = crearAppPrueba({ verificarBaseDeDatos: async () => true });
    const respuesta = await request(app).get('/api/v1/salud/listo');
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.datos.estado).toBe('ok');
  });

  it('GET /salud/listo responde 503 sin detallar la causa si la base de datos falla', async () => {
    const { app } = crearAppPrueba({ verificarBaseDeDatos: async () => false });
    const respuesta = await request(app).get('/api/v1/salud/listo');
    expect(respuesta.status).toBe(503);
    expect(respuesta.body).toEqual({ exito: false, datos: { estado: 'no_disponible' } });
  });

  it('devuelve un identificador de solicitud (X-Request-Id) y respeta uno válido entrante', async () => {
    const { app } = crearAppPrueba();
    const generado = await request(app).get('/api/v1/salud');
    expect(generado.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const propio = await request(app).get('/api/v1/salud').set('X-Request-Id', 'correlacion-1234');
    expect(propio.headers['x-request-id']).toBe('correlacion-1234');

    const hostil = await request(app).get('/api/v1/salud').set('X-Request-Id', 'x y\tinyeccion');
    expect(hostil.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('API - rutas inexistentes y errores', () => {
  it('una ruta inexistente responde 404 con el formato estándar de error (con token válido)', async () => {
    const { app, entorno } = crearAppPrueba();
    const token = await tokenValido(entorno);
    const respuesta = await request(app).get('/api/v1/no-existe').set('Authorization', `Bearer ${token}`);
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.exito).toBe(false);
    expect(respuesta.body.error.codigo).toBe('RUTA_NO_ENCONTRADA');
    expect(respuesta.body.error.idSolicitud).toBe(respuesta.headers['x-request-id']);
  });

  it('fuera de /api/v1 también responde 404 con el formato estándar', async () => {
    const { app } = crearAppPrueba();
    const respuesta = await request(app).get('/no-existe');
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.error.codigo).toBe('RUTA_NO_ENCONTRADA');
  });

  it('un fallo que no es del token no se disfraza de 401: responde 500', async () => {
    const { app } = crearAppPrueba({
      verificarToken: async () => {
        throw new Error('la base de datos no responde');
      },
    });
    const respuesta = await request(app).get('/api/v1/educacion/categorias').set('Authorization', 'Bearer aaaa.bbbb.cccc');
    expect(respuesta.status).toBe(500);
    expect(respuesta.body.error.codigo).toBe('ERROR_INTERNO');
    expect(JSON.stringify(respuesta.body)).not.toContain('base de datos');
  });

  it('responde 400 ante un JSON mal formado', async () => {
    const { app } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/salud').set('Content-Type', 'application/json').send('{"roto":');
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('JSON_INVALIDO');
  });

  it('responde 413 si el cuerpo supera el límite', async () => {
    const { app } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/salud').send({ relleno: 'x'.repeat(200_000) });
    expect(respuesta.status).toBe(413);
    expect(respuesta.body.error.codigo).toBe('CUERPO_DEMASIADO_GRANDE');
  });

  it('un error HTTP del cliente (por ejemplo, una subida cortada) responde 4xx y no un 500', async () => {
    const { app, servicio, entorno } = crearAppPrueba();
    vi.mocked(servicio.listarCategorias).mockRejectedValueOnce(
      Object.assign(new Error('detalle interno de la subida'), { status: 400, type: 'request.aborted' }),
    );
    const token = await tokenValido(entorno);
    const respuesta = await request(app).get('/api/v1/educacion/categorias').set('Authorization', `Bearer ${token}`);
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('SOLICITUD_INVALIDA');
    expect(JSON.stringify(respuesta.body)).not.toContain('detalle interno');
  });

  it('un fallo interno responde 500 sin filtrar el detalle al cliente', async () => {
    const { app, servicio } = crearAppPrueba();
    vi.mocked(servicio.listarCategorias).mockRejectedValueOnce(new Error('detalle secreto: tabla dbo.usuario, contraseña del servidor'));
    const token = await tokenValido(crearEntornoPrueba({ CORS_ORIGINS: ENTORNO_ORIGEN }));

    const respuesta = await request(app).get('/api/v1/educacion/categorias').set('Authorization', `Bearer ${token}`);
    expect(respuesta.status).toBe(500);
    expect(respuesta.body.error.codigo).toBe('ERROR_INTERNO');
    expect(JSON.stringify(respuesta.body)).not.toMatch(/secreto|dbo\.|contraseña/);
  });
});

describe('API - autenticación y autorización', () => {
  let contexto: ReturnType<typeof crearAppPrueba>;

  beforeEach(() => {
    contexto = crearAppPrueba();
  });

  it('exige autenticación: sin token responde 401 con WWW-Authenticate', async () => {
    const respuesta = await request(contexto.app).get('/api/v1/educacion/categorias');
    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error.codigo).toBe('NO_AUTENTICADO');
    expect(respuesta.headers['www-authenticate']).toBe('Bearer');
    expect(contexto.servicio.listarCategorias).not.toHaveBeenCalled();
  });

  it.each([
    ['esquema distinto de Bearer', 'Basic dXNlcjpjbGF2ZQ=='],
    ['token sin las tres partes', 'Bearer abc'],
    ['token con caracteres inválidos', 'Bearer aaa.bbb.c c'],
  ])('rechaza la cabecera Authorization inválida (%s)', async (_motivo, cabecera) => {
    const respuesta = await request(contexto.app).get('/api/v1/educacion/categorias').set('Authorization', cabecera);
    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error.codigo).toBe('NO_AUTENTICADO');
  });

  it('rechaza un token malformado', async () => {
    const respuesta = await request(contexto.app).get('/api/v1/educacion/categorias').set('Authorization', 'Bearer aaaa.bbbb.cccc');
    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error.codigo).toBe('TOKEN_INVALIDO');
  });

  it('rechaza un token con firma incorrecta aunque su contenido sea válido', async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const falsificado = await new SignJWT({ rol: 'ADMINISTRADOR' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuer(contexto.entorno.JWT_ISSUER)
      .setAudience(contexto.entorno.JWT_AUDIENCE)
      .setIssuedAt(ahora)
      .setExpirationTime(ahora + 300)
      .sign(new TextEncoder().encode('otro-secreto-completamente-distinto-1234567890'));
    const respuesta = await request(contexto.app).get('/api/v1/educacion/categorias').set('Authorization', `Bearer ${falsificado}`);
    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error.codigo).toBe('TOKEN_INVALIDO');
  });

  it('acepta el esquema Bearer sin distinguir mayúsculas (RFC 9110)', async () => {
    const token = await tokenValido(contexto.entorno);
    const respuesta = await request(contexto.app).get('/api/v1/educacion/categorias').set('Authorization', `bearer ${token}`);
    expect(respuesta.status).toBe(200);
  });

  it('con un token válido devuelve los datos', async () => {
    const token = await tokenValido(contexto.entorno);
    const respuesta = await request(contexto.app).get('/api/v1/educacion/categorias').set('Authorization', `Bearer ${token}`);
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.exito).toBe(true);
    expect(respuesta.body.datos[0]).toMatchObject({ id: 1, nombre: 'Ahorro', totalLecciones: 2 });
  });
});

describe('API - denegación por defecto', () => {
  // Rutas que hoy no existen pero que la Fase III agregará: deben nacer protegidas.
  it.each([
    ['GET', '/api/v1/metas'],
    ['POST', '/api/v1/metas'],
    ['GET', '/api/v1/transacciones'],
    ['POST', '/api/v1/sincronizaciones'],
    ['GET', '/api/v1/usuarios/1'],
    ['GET', '/api/v1/educacion/otra-ruta'],
    ['GET', '/api/v1/no-existe'],
  ])('%s %s sin token responde 401 (nada bajo /api/v1 es público salvo /salud)', async (metodo, ruta) => {
    const { app } = crearAppPrueba();
    const respuesta = await request(app)[metodo === 'GET' ? 'get' : 'post'](ruta);
    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error.codigo).toBe('NO_AUTENTICADO');
  });

  it('solo /salud es público', async () => {
    const { app } = crearAppPrueba();
    expect((await request(app).get('/api/v1/salud')).status).toBe(200);
    expect((await request(app).get('/api/v1/salud/listo')).status).toBe(200);
  });
});

describe('API - validación de entradas', () => {
  let contexto: ReturnType<typeof crearAppPrueba>;
  let token: string;

  beforeEach(async () => {
    contexto = crearAppPrueba();
    token = await tokenValido(contexto.entorno);
  });

  const consultar = (ruta: string) => request(contexto.app).get(ruta).set('Authorization', `Bearer ${token}`);

  it('lista las lecciones con paginación por defecto', async () => {
    const respuesta = await consultar('/api/v1/educacion/categorias/1/lecciones');
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.paginacion).toEqual({ pagina: 1, limite: 20, total: 1, totalPaginas: 1 });
    expect(contexto.servicio.listarLecciones).toHaveBeenCalledWith(1, 1, 20);
  });

  it('respeta los parámetros de paginación válidos', async () => {
    await consultar('/api/v1/educacion/categorias/1/lecciones?pagina=3&limite=10');
    expect(contexto.servicio.listarLecciones).toHaveBeenCalledWith(1, 3, 10);
  });

  it.each([
    ['id no numérico', '/api/v1/educacion/categorias/abc/lecciones'],
    ['id con notación científica', '/api/v1/educacion/categorias/1e3/lecciones'],
    ['id cero', '/api/v1/educacion/categorias/0/lecciones'],
    ['límite excesivo', '/api/v1/educacion/categorias/1/lecciones?limite=1000'],
    ['página cero', '/api/v1/educacion/categorias/1/lecciones?pagina=0'],
    ['parámetro desconocido', '/api/v1/educacion/categorias/1/lecciones?orden=desc'],
    ['intento de inyección SQL', "/api/v1/educacion/categorias/1;DROP TABLE dbo.usuario--/lecciones"],
  ])('responde 400 (%s) y no llega al servicio', async (_motivo, ruta) => {
    const respuesta = await consultar(ruta);
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('DATOS_INVALIDOS');
    expect(contexto.servicio.listarLecciones).not.toHaveBeenCalled();
  });

  it('el 400 informa el campo inválido pero no refleja el valor recibido', async () => {
    const respuesta = await consultar('/api/v1/educacion/categorias/valor-hostil-<script>/lecciones');
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.detalles[0].campo).toBe('idCategoria');
    expect(JSON.stringify(respuesta.body)).not.toContain('script');
  });

  it('un parámetro desconocido se rechaza sin copiar su nombre en el mensaje', async () => {
    const respuesta = await consultar('/api/v1/educacion/categorias/1/lecciones?%3Cscript%3Ealert(1)%3C%2Fscript%3E=x');
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.detalles[0].mensaje).toBe('Campo no permitido.');
    expect(JSON.stringify(respuesta.body)).not.toContain('script');
  });

  it('responde 404 si la categoría no existe', async () => {
    const respuesta = await consultar('/api/v1/educacion/categorias/99/lecciones');
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.error.codigo).toBe('CATEGORIA_NO_ENCONTRADA');
  });
});

describe('API - CORS y límite de solicitudes', () => {
  it('permite únicamente los orígenes de la lista blanca', async () => {
    const { app } = crearAppPrueba();
    const permitido = await request(app).get('/api/v1/salud').set('Origin', ENTORNO_ORIGEN);
    expect(permitido.headers['access-control-allow-origin']).toBe(ENTORNO_ORIGEN);

    const ajeno = await request(app).get('/api/v1/salud').set('Origin', 'https://sitio-malicioso.test');
    expect(ajeno.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('no habilita CORS para ningún origen si la lista está vacía', async () => {
    const { app } = crearAppPrueba({}, crearEntornoPrueba());
    const respuesta = await request(app).get('/api/v1/salud').set('Origin', ENTORNO_ORIGEN);
    expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('responde 429 al superar el límite de solicitudes', async () => {
    const { app } = crearAppPrueba({}, crearEntornoPrueba({ RATE_LIMIT_MAX: '2' }));
    expect((await request(app).get('/api/v1/salud')).status).toBe(200);
    expect((await request(app).get('/api/v1/salud')).status).toBe(200);
    const bloqueada = await request(app).get('/api/v1/salud');
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body.error.codigo).toBe('DEMASIADAS_SOLICITUDES');
    expect(bloqueada.headers['ratelimit']).toBeDefined();
  });
});
