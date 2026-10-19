// Medición de latencias de referencia de la API (sin dependencias). NO es una prueba de carga: mide cuánto tardan las
// operaciones habituales con unos pocos usuarios simultáneos, en el equipo de desarrollo y con SQL Server en un contenedor.
//
// Requisitos: la pila en marcha (docker compose --profile api up -d) y, en el .env de la raíz, AUTH_RATE_LIMIT_MAX alto.
// Uso:        node tests/rendimiento/medir.mjs [--api http://localhost:3000] [--trabajadores 10] [--rondas 20]
import { randomUUID } from 'node:crypto';

const argumento = (nombre, porDefecto) => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : porDefecto;
};
const API = argumento('--api', 'http://localhost:3000');
const TRABAJADORES = Number(argumento('--trabajadores', '10'));
const RONDAS = Number(argumento('--rondas', '20'));
const CLAVE = 'una-clave-de-medicion-larga-1';

const percentil = (valores, p) => {
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)];
};
const redondear = (n) => Math.round(n * 10) / 10;

async function llamar(metodo, ruta, { cuerpo, token } = {}) {
  const inicio = performance.now();
  const respuesta = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const ms = performance.now() - inicio;
  const datos = respuesta.status === 204 ? null : await respuesta.json();
  return { estado: respuesta.status, ms, datos };
}

async function medir(nombre, tareas) {
  const inicio = performance.now();
  const resultados = (await Promise.all(tareas.map((tarea) => tarea()))).flat();
  const duracion = (performance.now() - inicio) / 1000;
  const tiempos = resultados.map((r) => r.ms);
  const errores = resultados.filter((r) => r.estado >= 400).length;
  const fila = { prueba: nombre, solicitudes: resultados.length, errores, 'p50 ms': redondear(percentil(tiempos, 50)), 'p95 ms': redondear(percentil(tiempos, 95)), 'máx ms': redondear(Math.max(...tiempos)), 'solic./s': redondear(resultados.length / duracion) };
  return fila;
}

const correo = `medicion-${randomUUID()}@example.com`;
const registro = await llamar('POST', '/api/v1/auth/registro', { cuerpo: { nombres: 'Medición', apellidos: 'Local', correo, contrasena: CLAVE } });
const sesion = await llamar('POST', '/api/v1/auth/login', { cuerpo: { correo, contrasena: CLAVE } });
if (registro.estado !== 201 || sesion.estado !== 200) {
  throw new Error(`No se pudo preparar la cuenta (registro ${registro.estado}, login ${sesion.estado}). ¿Está en marcha la API?`);
}
const token = sesion.datos.datos.tokenAcceso;
const fecha = new Date(Date.now() + 86_400_000 * 60).toISOString().slice(0, 10);
const meta = (await llamar('POST', '/api/v1/metas', { token, cuerpo: { nombre: 'Meta de medición', montoObjetivo: 100_000_000_000, fechaLimite: fecha } })).datos.datos;

// Calentamiento (conexiones del pool y planes de consulta)
for (let i = 0; i < 10; i += 1) await llamar('GET', '/api/v1/metas', { token });

const filas = [];
filas.push(await medir('GET /metas (1 usuario, secuencial)', [async () => { const r = []; for (let i = 0; i < 100; i += 1) r.push(await llamar('GET', '/api/v1/metas', { token })); return r; }]));
filas.push(await medir(`GET /metas (${TRABAJADORES} simultáneos)`, Array.from({ length: TRABAJADORES }, () => async () => { const r = []; for (let i = 0; i < RONDAS; i += 1) r.push(await llamar('GET', '/api/v1/metas', { token })); return r; })));
filas.push(await medir(`POST depósito (${TRABAJADORES} simultáneos)`, Array.from({ length: TRABAJADORES }, () => async () => { const r = []; for (let i = 0; i < RONDAS; i += 1) r.push(await llamar('POST', `/api/v1/metas/${meta.id}/depositos`, { token, cuerpo: { monto: 1_000, codigoGlobal: randomUUID() } })); return r; })));
filas.push(await medir('GET /movimientos (paginado, 1 usuario)', [async () => { const r = []; for (let i = 0; i < 100; i += 1) r.push(await llamar('GET', '/api/v1/movimientos?limite=20', { token })); return r; }]));
const inicioLogin = performance.now();
const loginsRestantes = [];
for (let i = 0; i < 5; i += 1) loginsRestantes.push(await llamar('POST', '/api/v1/auth/login', { cuerpo: { correo, contrasena: CLAVE } }));
filas.push({ prueba: 'POST /auth/login (scrypt, secuencial)', solicitudes: 5, errores: loginsRestantes.filter((r) => r.estado >= 400).length, 'p50 ms': redondear(percentil(loginsRestantes.map((r) => r.ms), 50)), 'p95 ms': redondear(percentil(loginsRestantes.map((r) => r.ms), 95)), 'máx ms': redondear(Math.max(...loginsRestantes.map((r) => r.ms))), 'solic./s': redondear(5 / ((performance.now() - inicioLogin) / 1000)) });

// Comprobación de coherencia: 1.000 por cada depósito exitoso
const final = (await llamar('GET', `/api/v1/metas/${meta.id}`, { token })).datos.datos;
const depositosOk = TRABAJADORES * RONDAS;
console.table(filas);
console.log(`Saldo final de la meta de medición: ${final.montoAhorrado} (esperado ${depositosOk * 1000}) → ${final.montoAhorrado === depositosOk * 1000 ? 'coherente' : 'DESCUADRADO'}`);
console.log(`Entorno: Node ${process.version}; API ${API}; ${TRABAJADORES} trabajadores × ${RONDAS} rondas; fecha ${new Date().toISOString()}`);
