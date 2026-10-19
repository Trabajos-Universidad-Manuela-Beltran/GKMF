// Pruebas del cliente HTTP (api.js) con un fetch simulado. Se ejecutan con:  node --test "src/js/*.test.mjs"
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crearClienteApi, ErrorApi } from './api.js';

const json = (estado, cuerpo) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });
const sesion = (acceso, refresco) => ({ exito: true, datos: { tokenAcceso: acceso, tokenRefresco: refresco, tipoToken: 'Bearer', expiraEnSegundos: 900, usuario: { id: 1 } } });
const errorApi = (estado, codigo) => ({ exito: false, error: { codigo, mensaje: `error ${codigo}` } });

/** Fetch simulado: responde con la siguiente función de la cola y registra cada solicitud. */
function crearFetchSimulado(respuestas) {
  const llamadas = [];
  const fetchImpl = async (url, opciones) => {
    llamadas.push({ url: String(url), metodo: opciones.method, autorizacion: opciones.headers.Authorization ?? null, cuerpo: opciones.body ? JSON.parse(opciones.body) : null });
    const siguiente = respuestas.shift();
    if (!siguiente) throw new Error(`Solicitud inesperada: ${opciones.method} ${url}`);
    return siguiente();
  };
  return { fetchImpl, llamadas };
}

describe('cliente de la API', () => {
  it('envía el token Bearer, no envía cookies y devuelve los datos', async () => {
    const { fetchImpl, llamadas } = crearFetchSimulado([() => json(200, sesion('A1', 'R1')), () => json(200, { exito: true, datos: [], resumen: {} })]);
    const api = crearClienteApi({ base: 'http://api.test/', fetchImpl });
    await api.iniciarSesion('ana@example.com', 'x');
    const respuesta = await api.listarMetas();

    assert.deepEqual(respuesta.datos, []);
    assert.equal(llamadas[1].url, 'http://api.test/api/v1/metas');
    assert.equal(llamadas[1].autorizacion, 'Bearer A1');
    assert.equal(llamadas[0].autorizacion, null); // el inicio de sesión no lleva token
  });

  it('convierte una respuesta de error en ErrorApi con su código y su mensaje seguro', async () => {
    const { fetchImpl } = crearFetchSimulado([() => json(401, errorApi(401, 'CREDENCIALES_INVALIDAS'))]);
    const api = crearClienteApi({ base: 'http://api.test', fetchImpl });
    await assert.rejects(api.iniciarSesion('a@b.co', 'x'), (error) => error instanceof ErrorApi && error.estado === 401 && error.codigo === 'CREDENCIALES_INVALIDAS' && error.mensaje === 'error CREDENCIALES_INVALIDAS');
  });

  it('un corte de red se informa como SIN_CONEXION con un mensaje para la persona', async () => {
    const api = crearClienteApi({ base: 'http://api.test', fetchImpl: async () => { throw new TypeError('fallo de red'); } });
    await assert.rejects(api.listarMetas(), (error) => error.codigo === 'SIN_CONEXION' && error.mensaje.includes('conexión'));
  });

  it('si el token de acceso venció, renueva UNA vez con el de refresco y reintenta la solicitud', async () => {
    const { fetchImpl, llamadas } = crearFetchSimulado([
      () => json(200, sesion('A1', 'R1')),
      () => json(401, errorApi(401, 'TOKEN_INVALIDO')),
      () => json(200, sesion('A2', 'R2')),
      () => json(200, { exito: true, datos: ['ok'], resumen: {} }),
    ]);
    const api = crearClienteApi({ base: 'http://api.test', fetchImpl });
    await api.iniciarSesion('a@b.co', 'x');
    const respuesta = await api.listarMetas();

    assert.deepEqual(respuesta.datos, ['ok']);
    assert.equal(llamadas[2].url, 'http://api.test/api/v1/auth/refresco');
    assert.deepEqual(llamadas[2].cuerpo, { tokenRefresco: 'R1' });
    assert.equal(llamadas[3].autorizacion, 'Bearer A2'); // el reintento usa el token nuevo
  });

  it('varias solicitudes que fallan a la vez comparten UNA sola renovación', async () => {
    const { fetchImpl, llamadas } = crearFetchSimulado([
      () => json(200, sesion('A1', 'R1')),
      () => json(401, errorApi(401, 'TOKEN_INVALIDO')),
      () => json(401, errorApi(401, 'TOKEN_INVALIDO')),
      () => json(200, sesion('A2', 'R2')),
      () => json(200, { exito: true, datos: [1], resumen: {} }),
      () => json(200, { exito: true, datos: [2], paginacion: {} }),
    ]);
    const api = crearClienteApi({ base: 'http://api.test', fetchImpl });
    await api.iniciarSesion('a@b.co', 'x');
    await Promise.all([api.listarMetas(), api.listarMovimientos()]);
    assert.equal(llamadas.filter((l) => l.url.endsWith('/auth/refresco')).length, 1);
  });

  it('si el servidor rechaza la renovación (401), olvida los tokens y avisa que la sesión expiró', async () => {
    let expirada = 0;
    const { fetchImpl } = crearFetchSimulado([() => json(200, sesion('A1', 'R1')), () => json(401, errorApi(401, 'TOKEN_INVALIDO')), () => json(401, errorApi(401, 'TOKEN_REFRESCO_INVALIDO'))]);
    const api = crearClienteApi({ base: 'http://api.test', fetchImpl, alSesionExpirada: () => { expirada += 1; } });
    await api.iniciarSesion('a@b.co', 'x');
    await assert.rejects(api.listarMetas(), (error) => error.estado === 401);
    assert.equal(expirada, 1);
    assert.equal(api.tieneSesion(), false);
  });

  it('un corte de red durante la renovación NO cierra la sesión (se puede reintentar)', async () => {
    let expirada = 0;
    const respuestas = [() => json(200, sesion('A1', 'R1')), () => json(401, errorApi(401, 'TOKEN_INVALIDO')), () => { throw new TypeError('sin red'); }];
    const api = crearClienteApi({ base: 'http://api.test', fetchImpl: async () => respuestas.shift()(), alSesionExpirada: () => { expirada += 1; } });
    await api.iniciarSesion('a@b.co', 'x');
    await assert.rejects(api.listarMetas(), (error) => error.codigo === 'SIN_CONEXION');
    assert.equal(expirada, 0);
    assert.equal(api.tieneSesion(), true);
  });

  it('si se cierra sesión mientras una renovación está en curso, esos tokens NO se guardan de nuevo', async () => {
    let liberarRenovacion;
    const esperaRenovacion = new Promise((resolver) => { liberarRenovacion = resolver; });
    const respuestas = [
      () => json(200, sesion('A1', 'R1')),
      () => json(401, errorApi(401, 'TOKEN_INVALIDO')),
      async () => { await esperaRenovacion; return json(200, sesion('A2', 'R2')); },
      () => new Response(null, { status: 204 }),
    ];
    const api = crearClienteApi({ base: 'http://api.test', fetchImpl: async () => respuestas.shift()() });
    await api.iniciarSesion('a@b.co', 'x');
    const pendiente = api.listarMetas().catch(() => 'cancelada');
    await new Promise((r) => setTimeout(r, 10));
    await api.cerrarSesion(); // la persona cierra sesión con la renovación todavía en vuelo
    liberarRenovacion();
    await pendiente;
    assert.equal(api.tieneSesion(), false);
  });

  it('el cierre de sesión revoca el token de refresco y olvida los tokens aunque el servidor no responda', async () => {
    const { fetchImpl, llamadas } = crearFetchSimulado([() => json(200, sesion('A1', 'R1')), () => { throw new TypeError('sin red'); }]);
    const api = crearClienteApi({ base: 'http://api.test', fetchImpl });
    await api.iniciarSesion('a@b.co', 'x');
    await api.cerrarSesion();
    assert.equal(api.tieneSesion(), false);
    assert.deepEqual(llamadas[1].cuerpo, { tokenRefresco: 'R1' });
  });
});
