import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { componerAplicacion, type Aplicacion } from '../../src/composicion.js';
import { cargarEntorno } from '../../src/config/entorno.js';
import { crearRepositorioCuentas } from '../../src/modulos/cuentas/cuentas.repositorio.js';
import { crearRepositorioMetas } from '../../src/modulos/metas/metas.repositorio.js';
import { crearLogger } from '../../src/utilidades/logger.js';

/**
 * Pruebas de integración de cuentas y metas contra SQL Server real (scripts 01 a 04 de /database aplicados y variables
 * de conexión en .env). Cada prueba crea sus propios usuarios con correos únicos: la cuenta de la API no puede borrar
 * filas (DENY DELETE), así que los datos de prueba permanecen; usan el dominio reservado example.com.
 * Se ejecutan con: npm run test:integracion
 */
const entorno = cargarEntorno({ ...process.env, LOG_LEVEL: 'silent', AUTH_RATE_LIMIT_MAX: '100000' });
const CLAVE = 'una-clave-de-prueba-larga-1';
const MANANA = new Date(Date.now() + 86_400_000 * 30).toISOString().slice(0, 10);

let aplicacion: Aplicacion;

beforeAll(() => {
  aplicacion = componerAplicacion(entorno, crearLogger(entorno));
});

afterAll(async () => {
  await aplicacion.conexion.cerrar();
});

const api = () => request(aplicacion.app);

async function consultar<T>(texto: string, parametros: Record<string, unknown> = {}): Promise<T[]> {
  const solicitud = (await aplicacion.conexion.pool()).request();
  for (const [nombre, valor] of Object.entries(parametros)) {
    solicitud.input(nombre, valor as string | number);
  }
  return (await solicitud.query<T>(texto)).recordset;
}

interface UsuarioCreado {
  id: number;
  correo: string;
  autorizacion: string;
  tokenRefresco: string;
}

/** Registra un usuario nuevo y abre sesión, todo por la API pública. */
async function crearUsuario(): Promise<UsuarioCreado> {
  const correo = `prueba-${randomUUID()}@example.com`;
  const registro = await api().post('/api/v1/auth/registro').send({ nombres: 'Usuaria', apellidos: 'De Prueba', correo, contrasena: CLAVE });
  expect(registro.status).toBe(201);
  const login = await api().post('/api/v1/auth/login').send({ correo, contrasena: CLAVE });
  expect(login.status).toBe(200);
  return { id: registro.body.datos.id, correo, autorizacion: `Bearer ${login.body.datos.tokenAcceso}`, tokenRefresco: login.body.datos.tokenRefresco };
}

async function crearMeta(usuario: UsuarioCreado, montoObjetivo = 100_000) {
  const respuesta = await api().post('/api/v1/metas').set('Authorization', usuario.autorizacion).send({ nombre: 'Meta de prueba', montoObjetivo, fechaLimite: MANANA });
  expect(respuesta.status).toBe(201);
  return respuesta.body.datos as { id: number; montoAhorrado: number; estado: string };
}

const depositar = (usuario: UsuarioCreado, idMeta: number, monto: number, extra: Record<string, unknown> = {}) =>
  api().post(`/api/v1/metas/${idMeta}/depositos`).set('Authorization', usuario.autorizacion).send({ monto, ...extra });

const retirar = (usuario: UsuarioCreado, idMeta: number, monto: number, extra: Record<string, unknown> = {}) =>
  api().post(`/api/v1/metas/${idMeta}/retiros`).set('Authorization', usuario.autorizacion).send({ monto, ...extra });

async function saldoYLibro(idMeta: number) {
  const [meta] = await consultar<{ monto_ahorrado: number; estado: string }>('SELECT monto_ahorrado, estado FROM dbo.meta_ahorro WHERE id_meta = @id;', { id: idMeta });
  const [libro] = await consultar<{ neto: number; movimientos: number }>(
    `SELECT COALESCE(SUM(CASE tipo WHEN 'DEPOSITO_META' THEN monto ELSE -monto END), 0) AS neto, COUNT(*) AS movimientos
       FROM dbo.transaccion WHERE id_meta = @id;`,
    { id: idMeta },
  );
  return { saldo: Number(meta?.monto_ahorrado), estado: meta?.estado, neto: Number(libro?.neto), movimientos: Number(libro?.movimientos) };
}

describe('cuentas: registro e inicio de sesión', () => {
  it('guarda un hash scrypt con sal (nunca la contraseña) y no devuelve datos sensibles', async () => {
    const usuario = await crearUsuario();
    const [fila] = await consultar<{ hash_contrasena: string; rol: string }>('SELECT hash_contrasena, rol FROM dbo.usuario WHERE id_usuario = @id;', { id: usuario.id });
    expect(fila?.hash_contrasena).toMatch(/^scrypt\$65536\$8\$2\$/);
    expect(fila?.hash_contrasena).not.toContain(CLAVE);
    expect(fila?.rol).toBe('USUARIO');
  });

  it('rechaza un correo repetido, también con otra capitalización (409)', async () => {
    const usuario = await crearUsuario();
    const repetido = await api()
      .post('/api/v1/auth/registro')
      .send({ nombres: 'Otra', apellidos: 'Persona', correo: usuario.correo.toUpperCase(), contrasena: CLAVE });
    expect(repetido.status).toBe(409);
    expect(repetido.body.error.codigo).toBe('CORREO_YA_REGISTRADO');
  });

  it('el rol de una cuenta nueva siempre es USUARIO: no se puede pedir ADMINISTRADOR', async () => {
    const respuesta = await api()
      .post('/api/v1/auth/registro')
      .send({ nombres: 'Intruso', apellidos: 'Prueba', correo: `prueba-${randomUUID()}@example.com`, contrasena: CLAVE, rol: 'ADMINISTRADOR' });
    expect(respuesta.status).toBe(400);
  });

  it('responde lo mismo ante un correo inexistente y una contraseña incorrecta (sin enumeración de usuarios)', async () => {
    const usuario = await crearUsuario();
    const incorrecta = await api().post('/api/v1/auth/login').send({ correo: usuario.correo, contrasena: 'clave-equivocada-123' });
    const inexistente = await api().post('/api/v1/auth/login').send({ correo: `nadie-${randomUUID()}@example.com`, contrasena: 'clave-equivocada-123' });
    expect(incorrecta.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(incorrecta.body.error.codigo).toBe(inexistente.body.error.codigo);
    expect(incorrecta.body.error.mensaje).toBe(inexistente.body.error.mensaje);
  });

  it('bloquea la cuenta tras 5 intentos fallidos, incluso con la contraseña correcta, y se desbloquea al vencer el plazo', async () => {
    const usuario = await crearUsuario();
    for (let intento = 1; intento <= entorno.LOGIN_MAX_ATTEMPTS; intento += 1) {
      const fallido = await api().post('/api/v1/auth/login').send({ correo: usuario.correo, contrasena: `incorrecta-${intento}-xxxx` });
      expect(fallido.status).toBe(401);
    }
    const [bloqueada] = await consultar<{ intentos_fallidos: number; bloqueado: number }>(
      'SELECT intentos_fallidos, CASE WHEN bloqueado_hasta > SYSUTCDATETIME() THEN 1 ELSE 0 END AS bloqueado FROM dbo.usuario WHERE id_usuario = @id;',
      { id: usuario.id },
    );
    expect(bloqueada).toMatchObject({ intentos_fallidos: entorno.LOGIN_MAX_ATTEMPTS, bloqueado: 1 });

    const conClaveCorrecta = await api().post('/api/v1/auth/login').send({ correo: usuario.correo, contrasena: CLAVE });
    expect(conClaveCorrecta.status).toBe(401);

    // Se simula que pasaron los minutos de bloqueo.
    await consultar('UPDATE dbo.usuario SET bloqueado_hasta = DATEADD(MINUTE, -1, SYSUTCDATETIME()) WHERE id_usuario = @id;', { id: usuario.id });
    const desbloqueada = await api().post('/api/v1/auth/login').send({ correo: usuario.correo, contrasena: CLAVE });
    expect(desbloqueada.status).toBe(200);
    const [reiniciada] = await consultar<{ intentos_fallidos: number; bloqueado_hasta: Date | null }>('SELECT intentos_fallidos, bloqueado_hasta FROM dbo.usuario WHERE id_usuario = @id;', { id: usuario.id });
    expect(reiniciada).toMatchObject({ intentos_fallidos: 0, bloqueado_hasta: null });
  });

  it('un fallo justo después de vencer el bloqueo no lo reactiva (el contador se reinicia)', async () => {
    const usuario = await crearUsuario();
    for (let i = 0; i < entorno.LOGIN_MAX_ATTEMPTS; i += 1) {
      await api().post('/api/v1/auth/login').send({ correo: usuario.correo, contrasena: `incorrecta-${i}-xxxxx` });
    }
    await consultar('UPDATE dbo.usuario SET bloqueado_hasta = DATEADD(MINUTE, -1, SYSUTCDATETIME()) WHERE id_usuario = @id;', { id: usuario.id });
    await api().post('/api/v1/auth/login').send({ correo: usuario.correo, contrasena: 'incorrecta-otra-vez-1' });
    const [fila] = await consultar<{ intentos_fallidos: number; bloqueado_hasta: Date | null }>('SELECT intentos_fallidos, bloqueado_hasta FROM dbo.usuario WHERE id_usuario = @id;', { id: usuario.id });
    expect(fila).toMatchObject({ intentos_fallidos: 1, bloqueado_hasta: null });
  });

  it('una cuenta desactivada no puede iniciar sesión', async () => {
    const usuario = await crearUsuario();
    await consultar('UPDATE dbo.usuario SET activo = 0 WHERE id_usuario = @id;', { id: usuario.id });
    const respuesta = await api().post('/api/v1/auth/login').send({ correo: usuario.correo, contrasena: CLAVE });
    expect(respuesta.status).toBe(401);
  });
});

describe('cuentas: tokens de refresco', () => {
  it('guarda solo el SHA-256 del token y lo rota en cada renovación', async () => {
    const usuario = await crearUsuario();
    const hashEsperado = createHash('sha256').update(usuario.tokenRefresco).digest('hex');
    const guardadas = await consultar<{ hash_token_refresco: string }>('SELECT hash_token_refresco FROM dbo.sesion WHERE id_usuario = @id;', { id: usuario.id });
    expect(guardadas.map((fila) => fila.hash_token_refresco)).toEqual([hashEsperado]);

    const renovada = await api().post('/api/v1/auth/refresco').send({ tokenRefresco: usuario.tokenRefresco });
    expect(renovada.status).toBe(200);
    expect(renovada.body.datos.tokenRefresco).not.toBe(usuario.tokenRefresco);

    // El token nuevo ya sirve con el nuevo token de acceso.
    const listado = await api().get('/api/v1/metas').set('Authorization', `Bearer ${renovada.body.datos.tokenAcceso}`);
    expect(listado.status).toBe(200);
  });

  it('detecta la reutilización de un token revocado y cierra TODAS las sesiones del usuario', async () => {
    const usuario = await crearUsuario();
    const primera = await api().post('/api/v1/auth/refresco').send({ tokenRefresco: usuario.tokenRefresco });
    expect(primera.status).toBe(200);

    // Alguien presenta de nuevo el token viejo (copiado): se rechaza y se revoca incluso el token nuevo.
    const reutilizado = await api().post('/api/v1/auth/refresco').send({ tokenRefresco: usuario.tokenRefresco });
    expect(reutilizado.status).toBe(401);
    const delLegitimo = await api().post('/api/v1/auth/refresco').send({ tokenRefresco: primera.body.datos.tokenRefresco });
    expect(delLegitimo.status).toBe(401);
    const [activas] = await consultar<{ total: number }>('SELECT COUNT(*) AS total FROM dbo.sesion WHERE id_usuario = @id AND fecha_revocacion IS NULL;', { id: usuario.id });
    expect(activas?.total).toBe(0);
  });

  it('con dos renovaciones simultáneas del mismo token, solo una prospera', async () => {
    const usuario = await crearUsuario();
    const respuestas = await Promise.all([
      api().post('/api/v1/auth/refresco').send({ tokenRefresco: usuario.tokenRefresco }),
      api().post('/api/v1/auth/refresco').send({ tokenRefresco: usuario.tokenRefresco }),
    ]);
    const estados = respuestas.map((respuesta) => respuesta.status).sort();
    expect(estados).toEqual([200, 401]);
  });

  it('el cierre de sesión revoca el token y es idempotente', async () => {
    const usuario = await crearUsuario();
    expect((await api().post('/api/v1/auth/cierre').send({ tokenRefresco: usuario.tokenRefresco })).status).toBe(204);
    expect((await api().post('/api/v1/auth/cierre').send({ tokenRefresco: usuario.tokenRefresco })).status).toBe(204);
    expect((await api().post('/api/v1/auth/refresco').send({ tokenRefresco: usuario.tokenRefresco })).status).toBe(401);
  });

  it('no renueva la sesión de una cuenta desactivada', async () => {
    const usuario = await crearUsuario();
    await consultar('UPDATE dbo.usuario SET activo = 0 WHERE id_usuario = @id;', { id: usuario.id });
    expect((await api().post('/api/v1/auth/refresco').send({ tokenRefresco: usuario.tokenRefresco })).status).toBe(401);
  });
});

describe('metas: creación y consulta', () => {
  it('crea una meta con saldo cero y la devuelve en el listado con su resumen', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario, 250_000);
    expect(meta).toMatchObject({ montoAhorrado: 0, estado: 'EN_PROGRESO' });

    const listado = await api().get('/api/v1/metas').set('Authorization', usuario.autorizacion);
    expect(listado.status).toBe(200);
    expect(listado.body.datos).toHaveLength(1);
    expect(listado.body.datos[0]).toMatchObject({ id: meta.id, nombre: 'Meta de prueba', montoObjetivo: 250_000, porcentaje: 0, fechaLimite: MANANA });
    expect(listado.body.resumen).toMatchObject({ totalAhorrado: 0, metasActivas: 1, metasCompletadas: 0 });
  });

  it('es idempotente por código global: repetir la creación devuelve la misma meta con 200', async () => {
    const usuario = await crearUsuario();
    const codigoGlobal = randomUUID();
    const datos = { nombre: 'Meta offline', montoObjetivo: 50_000, fechaLimite: MANANA, codigoGlobal };
    const primera = await api().post('/api/v1/metas').set('Authorization', usuario.autorizacion).send(datos);
    const repetida = await api().post('/api/v1/metas').set('Authorization', usuario.autorizacion).send(datos);
    expect(primera.status).toBe(201);
    expect(repetida.status).toBe(200);
    expect(repetida.body.datos.id).toBe(primera.body.datos.id);
    const [conteo] = await consultar<{ total: number }>('SELECT COUNT(*) AS total FROM dbo.meta_ahorro WHERE id_usuario = @id;', { id: usuario.id });
    expect(conteo?.total).toBe(1);
  });

  it('un código global usado por OTRO usuario es un conflicto y no revela esa meta', async () => {
    const [a, b] = [await crearUsuario(), await crearUsuario()];
    const codigoGlobal = randomUUID();
    await api().post('/api/v1/metas').set('Authorization', a.autorizacion).send({ nombre: 'De A', montoObjetivo: 10_000, fechaLimite: MANANA, codigoGlobal });
    const respuesta = await api().post('/api/v1/metas').set('Authorization', b.autorizacion).send({ nombre: 'De B', montoObjetivo: 10_000, fechaLimite: MANANA, codigoGlobal });
    expect(respuesta.status).toBe(409);
    expect(JSON.stringify(respuesta.body)).not.toContain('De A');
  });

  it('rechaza una fecha límite pasada (hora de Bogotá)', async () => {
    const usuario = await crearUsuario();
    const respuesta = await api().post('/api/v1/metas').set('Authorization', usuario.autorizacion).send({ nombre: 'Vieja', montoObjetivo: 1_000, fechaLimite: '2020-01-01' });
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('FECHA_LIMITE_INVALIDA');
  });

  it('una cuenta desactivada con un token todavía vigente no puede crear metas (403)', async () => {
    const usuario = await crearUsuario();
    await consultar('UPDATE dbo.usuario SET activo = 0 WHERE id_usuario = @id;', { id: usuario.id });
    const respuesta = await api().post('/api/v1/metas').set('Authorization', usuario.autorizacion).send({ nombre: 'X', montoObjetivo: 1_000, fechaLimite: MANANA });
    expect(respuesta.status).toBe(403);
    expect(respuesta.body.error.codigo).toBe('CUENTA_INACTIVA');
  });
});

describe('cuentas desactivadas con un token todavía vigente', () => {
  it('no pueden leer sus metas ni su historial (no basta con que el token siga sin vencer)', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario);
    await depositar(usuario, meta.id, 5_000);
    await consultar('UPDATE dbo.usuario SET activo = 0 WHERE id_usuario = @id;', { id: usuario.id });

    const metas = await api().get('/api/v1/metas').set('Authorization', usuario.autorizacion);
    const movimientos = await api().get('/api/v1/movimientos').set('Authorization', usuario.autorizacion);
    expect(metas.body.datos).toEqual([]);
    expect(metas.body.resumen).toMatchObject({ totalAhorrado: 0, netoEsteMes: 0 });
    expect(movimientos.body.datos).toEqual([]);
    expect((await depositar(usuario, meta.id, 1_000)).status).toBe(404);
  });

  it('el acceso se rechaza en la propia sentencia SQL si la cuenta se desactiva o bloquea justo antes de abrir la sesión', async () => {
    const usuario = await crearUsuario();
    const repositorio = crearRepositorioCuentas(aplicacion.conexion);
    await consultar('UPDATE dbo.usuario SET activo = 0 WHERE id_usuario = @id;', { id: usuario.id });
    expect(await repositorio.registrarAccesoExitoso(usuario.id)).toBe(false);
    await consultar('UPDATE dbo.usuario SET activo = 1, bloqueado_hasta = DATEADD(MINUTE, 10, SYSUTCDATETIME()) WHERE id_usuario = @id;', { id: usuario.id });
    expect(await repositorio.registrarAccesoExitoso(usuario.id)).toBe(false);
    await consultar('UPDATE dbo.usuario SET bloqueado_hasta = NULL WHERE id_usuario = @id;', { id: usuario.id });
    expect(await repositorio.registrarAccesoExitoso(usuario.id)).toBe(true);
  });
});

describe('metas: aislamiento entre usuarios (BOLA)', () => {
  it('un usuario no puede ver, depositar ni retirar de la meta de otro: responde 404 como si no existiera', async () => {
    const [propietaria, intruso] = [await crearUsuario(), await crearUsuario()];
    const meta = await crearMeta(propietaria);
    await depositar(propietaria, meta.id, 40_000);

    expect((await api().get(`/api/v1/metas/${meta.id}`).set('Authorization', intruso.autorizacion)).status).toBe(404);
    expect((await depositar(intruso, meta.id, 1_000)).status).toBe(404);
    expect((await retirar(intruso, meta.id, 1_000)).status).toBe(404);

    const ajeno = await api().get('/api/v1/metas').set('Authorization', intruso.autorizacion);
    expect(ajeno.body.datos).toEqual([]);
    const movimientos = await api().get(`/api/v1/movimientos?idMeta=${meta.id}`).set('Authorization', intruso.autorizacion);
    expect(movimientos.body.datos).toEqual([]);

    // El saldo de la propietaria no cambió.
    expect(await saldoYLibro(meta.id)).toMatchObject({ saldo: 40_000, movimientos: 1 });
  });
});

describe('metas: depósitos y retiros como transacciones ACID', () => {
  it('el depósito actualiza el saldo y asienta el movimiento en el libro mayor', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario);
    const respuesta = await depositar(usuario, meta.id, 30_000, { descripcion: 'Quincena' });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.datos.meta).toMatchObject({ montoAhorrado: 30_000, porcentaje: 30, estado: 'EN_PROGRESO' });
    expect(respuesta.body.datos.movimiento).toMatchObject({ tipo: 'DEPOSITO_META', monto: 30_000, descripcion: 'Quincena', idMeta: meta.id, nombreMeta: 'Meta de prueba' });
    expect(await saldoYLibro(meta.id)).toEqual({ saldo: 30_000, estado: 'EN_PROGRESO', neto: 30_000, movimientos: 1 });
  });

  it('un retiro mayor al saldo se rechaza (409) y no cambia nada', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario);
    await depositar(usuario, meta.id, 10_000);
    const respuesta = await retirar(usuario, meta.id, 10_000.01);
    expect(respuesta.status).toBe(409);
    expect(respuesta.body.error.codigo).toBe('SALDO_INSUFICIENTE');
    expect(await saldoYLibro(meta.id)).toMatchObject({ saldo: 10_000, movimientos: 1 });
  });

  it('maneja centavos sin errores de redondeo', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario);
    await depositar(usuario, meta.id, 0.1);
    await depositar(usuario, meta.id, 0.2);
    const respuesta = await retirar(usuario, meta.id, 0.3);
    expect(respuesta.status).toBe(201);
    expect(await saldoYLibro(meta.id)).toMatchObject({ saldo: 0, neto: 0, movimientos: 3 });
  });

  it('al alcanzar el objetivo la meta pasa a COMPLETADA, no admite más depósitos y vuelve a EN_PROGRESO si se retira', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario, 50_000);
    const completa = await depositar(usuario, meta.id, 50_000);
    expect(completa.body.datos.meta).toMatchObject({ estado: 'COMPLETADA', porcentaje: 100 });

    const extra = await depositar(usuario, meta.id, 1_000);
    expect(extra.status).toBe(409);
    expect(extra.body.error.codigo).toBe('META_NO_ADMITE_DEPOSITOS');

    const retiro = await retirar(usuario, meta.id, 10_000);
    expect(retiro.status).toBe(201);
    expect(retiro.body.datos.meta).toMatchObject({ estado: 'EN_PROGRESO', montoAhorrado: 40_000, porcentaje: 80 });
    expect(await saldoYLibro(meta.id)).toMatchObject({ saldo: 40_000, estado: 'EN_PROGRESO' });
  });

  it('es idempotente por código global: repetir un depósito no duplica el movimiento ni el saldo', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario);
    const codigoGlobal = randomUUID();
    const primero = await depositar(usuario, meta.id, 15_000, { codigoGlobal });
    const repetido = await depositar(usuario, meta.id, 15_000, { codigoGlobal });

    expect(primero.status).toBe(201);
    expect(repetido.status).toBe(200);
    expect(repetido.body.datos.movimiento.id).toBe(primero.body.datos.movimiento.id);
    expect(await saldoYLibro(meta.id)).toMatchObject({ saldo: 15_000, movimientos: 1 });
  });

  it('el mismo código global con otros datos es un conflicto (409) y no altera el saldo', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario);
    const codigoGlobal = randomUUID();
    await depositar(usuario, meta.id, 15_000, { codigoGlobal });
    const conflicto = await depositar(usuario, meta.id, 99_000, { codigoGlobal });
    expect(conflicto.status).toBe(409);
    expect(conflicto.body.error.codigo).toBe('CODIGO_GLOBAL_EN_USO');
    expect(await saldoYLibro(meta.id)).toMatchObject({ saldo: 15_000, movimientos: 1 });
  });

  it('diez solicitudes idénticas simultáneas con el mismo código producen UN solo movimiento', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario);
    const codigoGlobal = randomUUID();
    const respuestas = await Promise.all(Array.from({ length: 10 }, () => depositar(usuario, meta.id, 7_000, { codigoGlobal })));
    const estados = respuestas.map((respuesta) => respuesta.status);
    expect(estados.filter((estado) => estado === 201)).toHaveLength(1);
    expect(estados.filter((estado) => estado === 200)).toHaveLength(9);
    expect(await saldoYLibro(meta.id)).toMatchObject({ saldo: 7_000, movimientos: 1 });
  });

  it('CONCURRENCIA: diez retiros simultáneos nunca dejan el saldo negativo ni descuadran el libro', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario, 1_000_000);
    await depositar(usuario, meta.id, 100_000);

    const respuestas = await Promise.all(Array.from({ length: 10 }, () => retirar(usuario, meta.id, 20_000)));
    const exitosos = respuestas.filter((respuesta) => respuesta.status === 201);
    const rechazados = respuestas.filter((respuesta) => respuesta.status === 409);

    expect(exitosos).toHaveLength(5); // 100.000 alcanza para exactamente 5 retiros de 20.000
    expect(rechazados).toHaveLength(5);
    expect(rechazados.every((respuesta) => respuesta.body.error.codigo === 'SALDO_INSUFICIENTE')).toBe(true);
    const final = await saldoYLibro(meta.id);
    expect(final.saldo).toBe(0);
    expect(final.neto).toBe(final.saldo); // invariante: saldo = depósitos - retiros
    expect(final.movimientos).toBe(6);
  });

  it('CONCURRENCIA: depósitos simultáneos se suman todos (sin pérdida de actualizaciones)', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario, 1_000_000);
    const respuestas = await Promise.all(Array.from({ length: 20 }, () => depositar(usuario, meta.id, 1_000)));
    expect(respuestas.every((respuesta) => respuesta.status === 201)).toBe(true);
    expect(await saldoYLibro(meta.id)).toEqual({ saldo: 20_000, estado: 'EN_PROGRESO', neto: 20_000, movimientos: 20 });
  });

  it('ATOMICIDAD: si falla el asiento en el libro, el cambio de saldo también se deshace', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario);
    const repositorio = crearRepositorioMetas(aplicacion.conexion);

    // La descripción excede NVARCHAR(150): el UPDATE del saldo ya se ejecutó cuando el INSERT falla.
    await expect(
      repositorio.registrarMovimiento({ idUsuario: usuario.id, idMeta: meta.id, tipo: 'DEPOSITO_META', monto: 5_000, descripcion: 'x'.repeat(400), codigoGlobal: randomUUID() }),
    ).rejects.toBeDefined();

    expect(await saldoYLibro(meta.id)).toEqual({ saldo: 0, estado: 'EN_PROGRESO', neto: 0, movimientos: 0 });
    // La conexión quedó sana y la siguiente operación funciona.
    expect((await depositar(usuario, meta.id, 1_000)).status).toBe(201);
  });

  it('un depósito que desbordaría el saldo se rechaza con 400 y no deja cambios', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario, 100_000_000_000);
    const repositorio = crearRepositorioMetas(aplicacion.conexion);
    // Se fuerza un saldo casi en el tope de DECIMAL(14,2) directamente en la tabla; se devuelve a 0 al terminar para no
    // dejar la base descuadrada respecto del libro (otra prueba verifica ese invariante en toda la base).
    await consultar('UPDATE dbo.meta_ahorro SET monto_ahorrado = 999999999999.00 WHERE id_meta = @id;', { id: meta.id });
    try {
      await expect(
        repositorio.registrarMovimiento({ idUsuario: usuario.id, idMeta: meta.id, tipo: 'DEPOSITO_META', monto: 100_000_000_000, descripcion: 'desborde', codigoGlobal: randomUUID() }),
      ).rejects.toMatchObject({ estado: 400, codigo: 'MONTO_FUERA_DE_RANGO' });
      expect((await saldoYLibro(meta.id)).movimientos).toBe(0);
    } finally {
      await consultar('UPDATE dbo.meta_ahorro SET monto_ahorrado = 0 WHERE id_meta = @id;', { id: meta.id });
    }
  });

  it('INVARIANTE GLOBAL: en toda la base, el saldo de cada meta es igual a depósitos menos retiros del libro', async () => {
    const descuadradas = await consultar<{ id_meta: number }>(
      `SELECT m.id_meta
         FROM dbo.meta_ahorro AS m
         LEFT JOIN dbo.transaccion AS t ON t.id_meta = m.id_meta
        GROUP BY m.id_meta, m.monto_ahorrado
       HAVING m.monto_ahorrado <> COALESCE(SUM(CASE t.tipo WHEN 'DEPOSITO_META' THEN t.monto WHEN 'RETIRO_META' THEN -t.monto END), 0);`,
    );
    expect(descuadradas).toEqual([]);
  });
});

describe('movimientos e historial', () => {
  it('lista los movimientos del usuario del más reciente al más antiguo, con paginación y filtro por meta', async () => {
    const usuario = await crearUsuario();
    const [uno, dos] = [await crearMeta(usuario), await crearMeta(usuario)];
    await depositar(usuario, uno.id, 1_000, { descripcion: 'primero' });
    await depositar(usuario, dos.id, 2_000, { descripcion: 'segundo' });
    await retirar(usuario, uno.id, 500, { descripcion: 'tercero' });

    const todos = await api().get('/api/v1/movimientos?limite=2').set('Authorization', usuario.autorizacion);
    expect(todos.status).toBe(200);
    expect(todos.body.datos.map((m: { descripcion: string }) => m.descripcion)).toEqual(['tercero', 'segundo']);
    expect(todos.body.paginacion).toEqual({ pagina: 1, limite: 2, total: 3, totalPaginas: 2 });

    const segunda = await api().get('/api/v1/movimientos?limite=2&pagina=2').set('Authorization', usuario.autorizacion);
    expect(segunda.body.datos.map((m: { descripcion: string }) => m.descripcion)).toEqual(['primero']);

    const deUna = await api().get(`/api/v1/movimientos?idMeta=${uno.id}`).set('Authorization', usuario.autorizacion);
    expect(deUna.body.datos.map((m: { descripcion: string }) => m.descripcion)).toEqual(['tercero', 'primero']);
  });

  it('el resumen refleja el ahorro neto del mes y el promedio de avance', async () => {
    const usuario = await crearUsuario();
    const meta = await crearMeta(usuario, 100_000);
    await depositar(usuario, meta.id, 40_000);
    await retirar(usuario, meta.id, 10_000);
    const respuesta = await api().get('/api/v1/metas').set('Authorization', usuario.autorizacion);
    expect(respuesta.body.resumen).toMatchObject({ totalAhorrado: 30_000, metasActivas: 1, promedioProgreso: 30, netoEsteMes: 30_000 });
  });
});

describe('seguridad de la base de datos frente a las nuevas operaciones', () => {
  it('la cuenta de la API sigue sin poder alterar ni borrar el libro mayor', async () => {
    await expect(consultar('UPDATE dbo.transaccion SET monto = monto WHERE 1 = 0;')).rejects.toMatchObject({ number: 229 });
    await expect(consultar('DELETE FROM dbo.transaccion WHERE 1 = 0;')).rejects.toMatchObject({ number: 229 });
  });

  it('un texto hostil en el nombre de una meta se guarda como dato (consulta parametrizada) y no ejecuta nada', async () => {
    const usuario = await crearUsuario();
    const hostil = "x'); DROP TABLE dbo.logro; --";
    const respuesta = await api().post('/api/v1/metas').set('Authorization', usuario.autorizacion).send({ nombre: hostil, montoObjetivo: 1_000, fechaLimite: MANANA });
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.datos.nombre).toBe(hostil);
    const [logros] = await consultar<{ total: number }>('SELECT COUNT(*) AS total FROM dbo.logro;');
    expect(logros?.total).toBeGreaterThan(0);
  });
});

