import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { ErrorAplicacion } from '../../src/middlewares/errores.js';
import type { ServicioMetas } from '../../src/modulos/metas/metas.servicio.js';
import { crearServicioTokens } from '../../src/seguridad/tokens.js';
import { crearLogger } from '../../src/utilidades/logger.js';
import { crearEntornoPrueba, crearServicioCuentasFalso, crearServicioMetasFalso, META_PRUEBA, MOVIMIENTO_PRUEBA } from './apoyo.js';

const entorno = crearEntornoPrueba();
const tokens = crearServicioTokens(entorno);

function crearAppPrueba(servicioMetas: ServicioMetas = crearServicioMetasFalso()) {
  const app = crearApp({
    entorno,
    logger: crearLogger(entorno),
    verificarBaseDeDatos: async () => true,
    verificarToken: (token) => tokens.verificar(token),
    servicioEducacion: { listarCategorias: vi.fn(), listarLecciones: vi.fn() },
    servicioCuentas: crearServicioCuentasFalso(),
    servicioMetas,
  });
  return { app, servicioMetas };
}

let autorizacion: string;
beforeEach(async () => {
  autorizacion = `Bearer ${await tokens.emitir({ idUsuario: 42, rol: 'USUARIO' })}`;
});

describe('POST /api/v1/metas', () => {
  const cuerpo = { nombre: 'Mercado del mes', montoObjetivo: 100_000, fechaLimite: '2026-12-30' };

  it('crea la meta para el usuario del TOKEN y responde 201', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/metas').set('Authorization', autorizacion).send(cuerpo);
    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toEqual({ exito: true, datos: META_PRUEBA });
    expect(servicioMetas.crearMeta).toHaveBeenCalledWith(42, cuerpo);
  });

  it('ignora cualquier intento de indicar el propietario: el cuerpo no admite idUsuario', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/metas').set('Authorization', autorizacion).send({ ...cuerpo, idUsuario: 1 });
    expect(respuesta.status).toBe(400);
    expect(servicioMetas.crearMeta).not.toHaveBeenCalled();
  });

  it('responde 200 cuando es el reintento de una solicitud ya procesada', async () => {
    const servicio = crearServicioMetasFalso();
    vi.mocked(servicio.crearMeta).mockResolvedValueOnce({ meta: META_PRUEBA, creada: false });
    const { app } = crearAppPrueba(servicio);
    const respuesta = await request(app)
      .post('/api/v1/metas')
      .set('Authorization', autorizacion)
      .send({ ...cuerpo, codigoGlobal: '55555555-5555-4555-8555-555555555555' });
    expect(respuesta.status).toBe(200);
  });

  it.each([
    ['monto cero', { ...cuerpo, montoObjetivo: 0 }],
    ['monto negativo', { ...cuerpo, montoObjetivo: -5 }],
    ['monto como texto', { ...cuerpo, montoObjetivo: '100000' }],
    ['monto con 3 decimales', { ...cuerpo, montoObjetivo: 10.123 }],
    ['monto sobre el máximo', { ...cuerpo, montoObjetivo: 1e12 }],
    ['fecha con formato inválido', { ...cuerpo, fechaLimite: '30/12/2026' }],
    ['fecha imposible', { ...cuerpo, fechaLimite: '2026-02-31' }],
    ['nombre vacío', { ...cuerpo, nombre: '  ' }],
    ['nombre con salto de línea', { ...cuerpo, nombre: 'Línea 1\nLínea 2' }],
    ['nombre de 101 caracteres', { ...cuerpo, nombre: 'x'.repeat(101) }],
    ['icono con marcado', { ...cuerpo, icono: '<img src=x>' }],
    ['código global que no es UUID', { ...cuerpo, codigoGlobal: 'abc' }],
    ['monto de una milmillonésima (se redondearía a 0,00)', { ...cuerpo, montoObjetivo: 1e-9 }],
  ])('rechaza con 400: %s', async (_caso, datos) => {
    const { app, servicioMetas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/metas').set('Authorization', autorizacion).send(datos);
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('DATOS_INVALIDOS');
    expect(servicioMetas.crearMeta).not.toHaveBeenCalled();
  });

  it('redondea a centavos un monto con error de coma flotante antes de pasarlo al servicio (30.299999999999997 → 30,30)', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/metas').set('Authorization', autorizacion).send({ ...cuerpo, montoObjetivo: 30.299999999999997 });
    expect(respuesta.status).toBe(201);
    expect(vi.mocked(servicioMetas.crearMeta).mock.calls[0]?.[1].montoObjetivo).toBe(30.3);
  });

  it('acepta montos con 2 decimales aunque la coma flotante los represente mal (0,29)', async () => {
    const { app } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/metas').set('Authorization', autorizacion).send({ ...cuerpo, montoObjetivo: 0.29 });
    expect(respuesta.status).toBe(201);
  });
});

describe('GET /api/v1/metas', () => {
  it('lista las metas del usuario con su resumen', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    const respuesta = await request(app).get('/api/v1/metas').set('Authorization', autorizacion);
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.datos).toEqual([META_PRUEBA]);
    expect(respuesta.body.resumen.totalAhorrado).toBe(72_000);
    expect(servicioMetas.listarMetas).toHaveBeenCalledWith(42, undefined);
  });

  it('filtra por estado y rechaza estados desconocidos', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    await request(app).get('/api/v1/metas?estado=COMPLETADA').set('Authorization', autorizacion);
    expect(servicioMetas.listarMetas).toHaveBeenCalledWith(42, 'COMPLETADA');
    const invalida = await request(app).get('/api/v1/metas?estado=CUALQUIERA').set('Authorization', autorizacion);
    expect(invalida.status).toBe(400);
  });
});

describe('GET /api/v1/metas/:idMeta', () => {
  it('consulta con el usuario del token', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    const respuesta = await request(app).get('/api/v1/metas/9').set('Authorization', autorizacion);
    expect(respuesta.status).toBe(200);
    expect(servicioMetas.obtenerMeta).toHaveBeenCalledWith(42, 9);
  });

  it('responde 404 sin distinguir entre inexistente y ajena', async () => {
    const servicio = crearServicioMetasFalso();
    vi.mocked(servicio.obtenerMeta).mockRejectedValueOnce(new ErrorAplicacion(404, 'META_NO_ENCONTRADA', 'La meta de ahorro no existe.'));
    const { app } = crearAppPrueba(servicio);
    const respuesta = await request(app).get('/api/v1/metas/9').set('Authorization', autorizacion);
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.error.codigo).toBe('META_NO_ENCONTRADA');
  });

  it.each(['0', '-1', 'abc', '1e3', '1.5', '99999999999', '2147483648', '3000000000'])('rechaza el identificador inválido %s (incluidos los que no caben en INT de SQL Server)', async (id) => {
    const { app, servicioMetas } = crearAppPrueba();
    const respuesta = await request(app).get(`/api/v1/metas/${id}`).set('Authorization', autorizacion);
    expect(respuesta.status).toBe(400);
    expect(servicioMetas.obtenerMeta).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/metas/:idMeta/depositos y /retiros', () => {
  it('deposita con el usuario del token y devuelve movimiento y meta (201)', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/metas/3/depositos').set('Authorization', autorizacion).send({ monto: 20_000, descripcion: 'Quincena' });
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.datos).toEqual({ movimiento: MOVIMIENTO_PRUEBA, meta: META_PRUEBA });
    expect(servicioMetas.depositar).toHaveBeenCalledWith(42, 3, { monto: 20_000, descripcion: 'Quincena' });
  });

  it('retira con el usuario del token', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    const respuesta = await request(app).post('/api/v1/metas/3/retiros').set('Authorization', autorizacion).send({ monto: 5_000 });
    expect(respuesta.status).toBe(201);
    expect(servicioMetas.retirar).toHaveBeenCalledWith(42, 3, { monto: 5_000 });
  });

  it('responde 200 y no 201 cuando la operación repetía un código ya procesado', async () => {
    const servicio = crearServicioMetasFalso();
    vi.mocked(servicio.depositar).mockResolvedValueOnce({ meta: META_PRUEBA, movimiento: MOVIMIENTO_PRUEBA, creado: false });
    const { app } = crearAppPrueba(servicio);
    const respuesta = await request(app)
      .post('/api/v1/metas/3/depositos')
      .set('Authorization', autorizacion)
      .send({ monto: 20_000, codigoGlobal: '66666666-6666-4666-8666-666666666666' });
    expect(respuesta.status).toBe(200);
  });

  it('traduce los errores de negocio (409 saldo insuficiente)', async () => {
    const servicio = crearServicioMetasFalso();
    vi.mocked(servicio.retirar).mockRejectedValueOnce(new ErrorAplicacion(409, 'SALDO_INSUFICIENTE', 'La meta no tiene saldo suficiente para ese retiro.'));
    const { app } = crearAppPrueba(servicio);
    const respuesta = await request(app).post('/api/v1/metas/3/retiros').set('Authorization', autorizacion).send({ monto: 999_999 });
    expect(respuesta.status).toBe(409);
    expect(respuesta.body.error.codigo).toBe('SALDO_INSUFICIENTE');
  });

  it.each([
    ['sin monto', {}],
    ['monto cero', { monto: 0 }],
    ['monto negativo', { monto: -100 }],
    ['monto en texto', { monto: '100' }],
    ['monto con 3 decimales', { monto: 1.005 }],
    ['campo no permitido', { monto: 100, idUsuario: 1 }],
    ['descripción con caracteres de control', { monto: 100, descripcion: 'a\u0000b' }],
  ])('rechaza con 400: %s', async (_caso, datos) => {
    const { app, servicioMetas } = crearAppPrueba();
    for (const ruta of ['depositos', 'retiros']) {
      const respuesta = await request(app).post(`/api/v1/metas/3/${ruta}`).set('Authorization', autorizacion).send(datos);
      expect(respuesta.status).toBe(400);
    }
    expect(servicioMetas.depositar).not.toHaveBeenCalled();
    expect(servicioMetas.retirar).not.toHaveBeenCalled();
  });

  it('un token manipulado no llega a las operaciones', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    const partes = autorizacion.split('.');
    const manipulado = `${partes[0]}.${Buffer.from(JSON.stringify({ sub: '1', rol: 'ADMINISTRADOR', iat: 1, exp: 9999999999 })).toString('base64url')}.${partes[2]}`;
    const respuesta = await request(app).post('/api/v1/metas/3/depositos').set('Authorization', manipulado).send({ monto: 1 });
    expect(respuesta.status).toBe(401);
    expect(servicioMetas.depositar).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/movimientos', () => {
  it('pagina el historial del usuario', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    const respuesta = await request(app).get('/api/v1/movimientos?pagina=2&limite=10&idMeta=3').set('Authorization', autorizacion);
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.datos).toEqual([MOVIMIENTO_PRUEBA]);
    expect(respuesta.body.paginacion.total).toBe(1);
    expect(servicioMetas.listarMovimientos).toHaveBeenCalledWith(42, { pagina: 2, limite: 10, idMeta: 3 });
  });

  it('aplica valores por defecto y rechaza límites abusivos', async () => {
    const { app, servicioMetas } = crearAppPrueba();
    await request(app).get('/api/v1/movimientos').set('Authorization', autorizacion);
    expect(servicioMetas.listarMovimientos).toHaveBeenCalledWith(42, { pagina: 1, limite: 20 });
    expect((await request(app).get('/api/v1/movimientos?limite=1000').set('Authorization', autorizacion)).status).toBe(400);
    expect((await request(app).get('/api/v1/movimientos?pagina=0').set('Authorization', autorizacion)).status).toBe(400);
  });
});
