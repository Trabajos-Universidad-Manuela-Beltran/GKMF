// Prueba de extremo a extremo de la interfaz conectada a la API real (Edge headless por CDP, sin dependencias).
//
// Requisitos: la pila en marcha  ->  docker compose --profile api --profile web up -d --build
// Uso:        node tests/e2e/flujo-metas.mjs [--capturas docs/capturas-fase3] [--web http://localhost:8080]
//
// Recorre el flujo completo de una persona nueva (registro, metas, abonos, retiros, historial, educación, cierre de
// sesión y nuevo inicio) y comprueba el resultado en pantalla. También falla si el navegador registra una violación de
// la CSP o un error de consola, porque la interfaz debe funcionar sin scripts en línea.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const argumento = (nombre, porDefecto) => {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : porDefecto;
};
const WEB = argumento('--web', 'http://localhost:8080');
const CARPETA_CAPTURAS = argumento('--capturas', '') ? resolve(argumento('--capturas', '')) : '';
const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PUERTO = 9351;
const CORREO = `e2e-${Date.now()}@example.com`;
const CLAVE = 'una-clave-e2e-bien-larga-1';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const comprobar = (nombre, ok, detalle = '') => {
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
};

if (CARPETA_CAPTURAS) {
  mkdirSync(CARPETA_CAPTURAS, { recursive: true });
}
const perfil = mkdtempSync(join(tmpdir(), 'edge-e2e-'));
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

async function conectar() {
  for (let i = 0; i < 80; i++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json`)).json();
      const pagina = lista.find((t) => t.type === 'page');
      if (pagina) return pagina.webSocketDebuggerUrl;
    } catch {
      /* Edge aún no escucha */
    }
    await dormir(250);
  }
  throw new Error('Edge no abrió el puerto CDP');
}

try {
  const ws = new WebSocket(await conectar());
  await new Promise((ok, mal) => {
    ws.onopen = ok;
    ws.onerror = mal;
  });
  let n = 0;
  const pendientes = new Map();
  const problemas = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pendientes.has(m.id)) {
      const { ok, mal } = pendientes.get(m.id);
      pendientes.delete(m.id);
      m.error ? mal(new Error(JSON.stringify(m.error))) : ok(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      problemas.push(`EXCEPCIÓN: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problemas.push(`consola.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    } else if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) {
      // El 401 de un inicio de sesión con clave incorrecta es el comportamiento CORRECTO que el navegador anota como error de red.
      const esperado = m.params.entry.text.includes('status of 401') && (m.params.entry.url ?? '').endsWith('/api/v1/auth/login');
      if (!esperado) {
        problemas.push(`log.${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
      }
    }
  };
  const cdp = (metodo, params = {}) =>
    new Promise((ok, mal) => {
      const id = ++n;
      pendientes.set(id, { ok, mal });
      ws.send(JSON.stringify({ id, method: metodo, params }));
    });
  const evaluar = async (expresion) => {
    const r = await cdp('Runtime.evaluate', { expression: expresion, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error al evaluar');
    return r.result.value;
  };
  const esperar = async (expresion, descripcion, ms = 8000) => {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      if (await evaluar(`Boolean(${expresion})`)) return true;
      await dormir(120);
    }
    throw new Error(`Se agotó la espera: ${descripcion}`);
  };
  const clic = (selector) => evaluar(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
  const escribir = (selector, valor) =>
    evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const seVe = (selector) => evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && e.getClientRects().length > 0; })()`);
  const texto = (selector) => evaluar(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`);
  const capturar = async (nombre, conAviso = false) => {
    if (!CARPETA_CAPTURAS) return;
    // Las capturas de documentación no deben mostrar el aviso de la acción anterior: se espera a que desaparezca.
    if (!conAviso) await esperar(`!document.querySelector('#aviso').classList.contains('visible')`, 'que desaparezca el aviso', 6000).catch(() => {});
    await dormir(450); // deja terminar las transiciones
    const caja = await evaluar(`(() => { const r = document.querySelector('.phone').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: caja.x, y: caja.y, width: caja.w, height: caja.h, scale: 1 } });
    writeFileSync(join(CARPETA_CAPTURAS, `${nombre}.png`), Buffer.from(data, 'base64'));
  };

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 500, height: 900, deviceScaleFactor: 2, mobile: false });
  await cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await cdp('Page.navigate', { url: `${WEB}/` });

  // ── Acceso ────────────────────────────────────────────────────────────────────────────────────
  await esperar(`document.querySelector('#auth.active')`, 'pantalla de acceso tras el splash', 10000);
  comprobar('La interfaz carga y muestra la pantalla de acceso', true);
  comprobar('No hay scripts ni manejadores en línea en el HTML', await evaluar(`!document.querySelector('script:not([src])') && ![...document.querySelectorAll('*')].some((e) => [...e.attributes].some((a) => a.name.startsWith('on')))`));
  await capturar('01_acceso');

  await clic('#tab-registro');
  comprobar('La pestaña "Crear cuenta" muestra el formulario de registro', await evaluar(`!document.querySelector('#panel-registro').hidden && document.querySelector('#panel-login').hidden`));

  // Validación en el cliente: contraseña corta
  await escribir('#registro-nombres', 'Ana María');
  await escribir('#registro-apellidos', 'Pérez');
  await escribir('#registro-correo', CORREO);
  await escribir('#registro-contrasena', 'corta');
  await clic('#panel-registro button[type=submit]');
  comprobar('Una contraseña corta se rechaza antes de enviar, con el campo marcado', (await texto('#registro-contrasena-error'))?.includes('12 caracteres') && (await evaluar(`document.querySelector('#registro-contrasena').getAttribute('aria-invalid')`)) === 'true');
  await capturar('02_registro_validacion');

  // ── Registro y primer inicio de sesión ────────────────────────────────────────────────────────
  await escribir('#registro-contrasena', CLAVE);
  await clic('#panel-registro button[type=submit]');
  await esperar(`document.querySelector('#dashboard.active') && document.querySelector('#nombre-usuario').textContent.trim() !== ''`, 'el panel principal tras registrarse');
  comprobar('Registrarse inicia sesión y abre el panel con el nombre de la persona', (await texto('#nombre-usuario')) === 'Ana');
  comprobar('El panel de una cuenta nueva muestra $0 y el estado vacío de metas (visible)', (await texto('#total-ahorrado')) === '$0' && (await seVe('#metas-inicio-vacio')) && !(await seVe('#metas-inicio')));
  await capturar('03_inicio_vacio');

  // ── Crear metas ───────────────────────────────────────────────────────────────────────────────
  await clic('[data-accion="nueva-meta"].quick-item');
  await esperar(`document.querySelector('#hoja-meta-nueva[open]')`, 'la hoja de nueva meta');
  comprobar('La hoja de nueva meta se abre y el resto de la pantalla queda inerte', await evaluar(`document.querySelector('#dashboard').inert === true`));
  await clic('#hoja-meta-nueva [data-accion="cerrar-hoja"]');
  comprobar('Cerrar la hoja devuelve la interacción a la pantalla', await evaluar(`!document.querySelector('#hoja-meta-nueva').open && document.querySelector('#dashboard').inert === false`));

  await clic('[data-accion="nueva-meta"].quick-item');
  await esperar(`document.querySelector('#hoja-meta-nueva[open]')`, 'la hoja de nueva meta (2)');
  await escribir('#meta-nombre', 'Mercado del mes');
  await escribir('#meta-objetivo', 'abc');
  await clic('#form-meta-nueva button[type=submit]');
  comprobar('Un monto inválido se rechaza con un mensaje junto al campo', (await texto('#meta-objetivo-error'))?.includes('monto válido'));
  await escribir('#meta-objetivo', '100.000');
  await evaluar(`document.querySelector('#selector-iconos input[value="carrito"]').click(); true`);
  await capturar('04_nueva_meta');
  await clic('#form-meta-nueva button[type=submit]');
  await esperar(`document.querySelectorAll('#metas-inicio .goal-card').length === 1`, 'la primera meta en el carrusel');
  comprobar('La meta creada aparece en el panel y el estado vacío DEJA de verse', (await texto('#metas-inicio .goal-name')) === 'Mercado del mes' && (await texto('#n-activas')) === '1' && !(await seVe('#metas-inicio-vacio')) && (await seVe('#metas-inicio')));

  await clic('[data-accion="nueva-meta"].quick-item');
  await esperar(`document.querySelector('#hoja-meta-nueva[open]')`, 'la hoja de nueva meta (3)');
  await escribir('#meta-nombre', 'Útiles del colegio');
  await escribir('#meta-objetivo', '200000');
  await evaluar(`document.querySelector('#selector-iconos input[value="libro"]').click(); true`);
  await clic('#form-meta-nueva button[type=submit]');
  await esperar(`document.querySelectorAll('#metas-inicio .goal-card').length === 2`, 'la segunda meta');
  comprobar('Se pueden crear varias metas', (await texto('#n-activas')) === '2');

  // ── Abonar ────────────────────────────────────────────────────────────────────────────────────
  await clic('#metas-inicio .goal-card .card-hit');
  await esperar(`document.querySelector('#hoja-meta-detalle[open]')`, 'el detalle de la meta');
  comprobar('El detalle de una meta nueva tiene "Retirar" deshabilitado (no hay saldo)', await evaluar(`document.querySelector('#btn-retirar').disabled === true`));
  await clic('#btn-abonar');
  await esperar(`document.querySelector('#hoja-movimiento[open]')`, 'la hoja de abono');
  await escribir('#movimiento-monto', '72.000');
  await escribir('#movimiento-descripcion', 'Quincena');
  await capturar('05_abonar');
  await clic('#form-movimiento button[type=submit]');
  await esperar(`document.querySelector('#total-ahorrado').textContent.trim() === '$72.000'`, 'el total actualizado tras el abono');
  comprobar('Abonar actualiza el total ahorrado', (await texto('#total-ahorrado')) === '$72.000');
  await capturar('06a_aviso_abono', true);
  comprobar('El abono aparece en los últimos movimientos', (await texto('#movimientos-inicio .tx-name')) === 'Quincena' && (await texto('#movimientos-inicio .tx-amount')) === '+$72.000');
  comprobar('"Este mes" refleja el ahorro neto', (await texto('#neto-mes')) === '+$72.000');
  await capturar('06_inicio_con_metas');

  // ── Retirar ───────────────────────────────────────────────────────────────────────────────────
  await clic('#metas-inicio .goal-card .card-hit');
  await esperar(`document.querySelector('#hoja-meta-detalle[open]') && document.querySelector('#detalle-ahorrado').textContent.trim() === '$72.000'`, 'el detalle con saldo');
  await esperar(`document.querySelectorAll('#detalle-movimientos .tx-item').length === 1`, 'el historial de la meta');
  comprobar('El detalle de la meta no muestra "sin movimientos" cuando sí los hay', !(await seVe('#detalle-movimientos-vacio')) && (await seVe('#detalle-movimientos')));
  await capturar('07_detalle_meta');
  await clic('#btn-retirar');
  await esperar(`document.querySelector('#hoja-movimiento[open]')`, 'la hoja de retiro');
  await escribir('#movimiento-monto', '500000');
  await clic('#form-movimiento button[type=submit]');
  comprobar('Retirar más de lo que hay se rechaza con un mensaje claro', (await texto('#movimiento-monto-error'))?.includes('Solo tienes $72.000'));
  await escribir('#movimiento-monto', '12.000');
  await clic('#form-movimiento button[type=submit]');
  await esperar(`document.querySelector('#total-ahorrado').textContent.trim() === '$60.000'`, 'el total tras el retiro');
  comprobar('Retirar actualiza el total ahorrado', (await texto('#total-ahorrado')) === '$60.000');

  // ── Historial ─────────────────────────────────────────────────────────────────────────────────
  await clic('.quick-item[data-ir="movements"]');
  await esperar(`document.querySelector('#movements.active') && document.querySelectorAll('#lista-movimientos .tx-item').length === 2`, 'el historial completo');
  comprobar('El historial lista los dos movimientos, el más reciente primero', (await texto('#lista-movimientos .tx-item:first-child .tx-amount')) === '\u2212$12.000');
  await capturar('08_movimientos');

  // ── Mis metas y filtros ───────────────────────────────────────────────────────────────────────
  await clic('#main-nav [data-ir="dashboard"]').catch(() => {});
  await clic('.btn-back[data-ir="dashboard"]');
  await clic('.section-action[data-ir="savings"]');
  await esperar(`document.querySelector('#savings.active') && document.querySelectorAll('#lista-metas .savings-card').length === 2`, 'la lista de metas');
  comprobar('"Mis metas" muestra las dos metas con sus resúmenes', (await texto('#stat-activas')) === '2' && (await texto('#stat-ahorrado')) === '$60K');
  await clic('[data-filtro="completadas"]');
  comprobar('El filtro "Completadas" no muestra metas y avisa', (await evaluar(`document.querySelectorAll('#lista-metas .savings-card').length`)) === 0 && (await evaluar(`!document.querySelector('#metas-vacio').hidden`)));
  await clic('[data-filtro="todas"]');
  await capturar('09_metas');

  // ── Educación ─────────────────────────────────────────────────────────────────────────────────
  await clic('#main-nav [data-ir="education"]');
  await esperar(`document.querySelectorAll('#lista-categorias .category-card').length > 0`, 'las categorías de educación');
  comprobar('Las categorías de educación vienen de la API', (await evaluar(`document.querySelectorAll('#lista-categorias .category-card').length`)) >= 3);
  await capturar('10_aprende');
  await clic('#lista-categorias .category-card');
  await esperar(`document.querySelector('#hoja-lecciones[open]') && document.querySelectorAll('#lista-lecciones .lesson-item').length > 0`, 'las lecciones de la categoría');
  comprobar('Una categoría muestra sus lecciones', true);
  await capturar('11_lecciones');
  await clic('#hoja-lecciones [data-accion="cerrar-hoja"]');

  // ── Perfil y cierre de sesión ─────────────────────────────────────────────────────────────────
  await clic('#main-nav [data-ir="profile"]');
  await esperar(`document.querySelector('#profile.active') && document.querySelector('#perfil-nombre').textContent.trim() !== ''`, 'el perfil');
  comprobar('El perfil muestra el nombre, el correo y las cifras reales', (await texto('#perfil-nombre')) === 'Ana María Pérez' && (await texto('#perfil-correo')) === CORREO && (await texto('#perfil-total')) === '$60.000');
  await capturar('12_perfil');
  await clic('[data-accion="cerrar-sesion"]');
  await esperar(`document.querySelector('#auth.active')`, 'volver a la pantalla de acceso');
  comprobar('Cerrar sesión vuelve al acceso y descarta los datos pintados', (await evaluar(`document.querySelectorAll('#lista-metas .savings-card, #lista-movimientos .tx-item').length`)) === 0);

  // ── Credenciales incorrectas y nuevo inicio ───────────────────────────────────────────────────
  await escribir('#login-correo', CORREO);
  await escribir('#login-contrasena', 'esta-no-es-la-clave');
  await clic('#panel-login button[type=submit]');
  await esperar(`!document.querySelector('#auth-aviso').hidden`, 'el aviso de credenciales incorrectas');
  const avisoLogin = await texto('#auth-aviso');
  comprobar('Una contraseña incorrecta muestra un mensaje genérico', avisoLogin?.includes('incorrectos') === true, avisoLogin ?? '(sin aviso)');
  await escribir('#login-contrasena', CLAVE);
  await clic('#panel-login button[type=submit]');
  await esperar(`document.querySelector('#dashboard.active') && document.querySelector('#total-ahorrado').textContent.trim() === '$60.000'`, 'el panel con los datos guardados');
  comprobar('Al volver a iniciar sesión los datos persistieron en la base de datos', (await texto('#total-ahorrado')) === '$60.000' && (await texto('#n-activas')) === '2');

  comprobar(
    'Todos los botones y campos visibles tienen nombre accesible',
    await evaluar(`(() => {
      const visible = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      const sinNombre = [...document.querySelectorAll('.screen.active button, .screen.active input, .screen.active textarea')]
        .filter(visible)
        .filter((e) => {
          if (e.tagName === 'BUTTON') return !(e.getAttribute('aria-label') || e.textContent.trim());
          return !(e.getAttribute('aria-label') || (e.id && document.querySelector('label[for="' + e.id + '"]')) || e.closest('label'));
        });
      return sinNombre.length === 0;
    })()`),
  );
  comprobar('Los controles táctiles miden al menos 44 px de alto', await evaluar(`[...document.querySelectorAll('.screen.active .btn, .screen.active .quick-item, .screen.active .nav-item, #main-nav .nav-item')].filter((e) => e.offsetHeight).every((e) => e.getBoundingClientRect().height >= 44)`));
  comprobar('El navegador no registró errores, excepciones ni violaciones de la CSP', problemas.length === 0, problemas.join(' | '));
  ws.close();
} catch (error) {
  comprobar('El recorrido terminó sin interrupciones', false, error.message);
} finally {
  edge.kill();
  await dormir(500);
  try {
    rmSync(perfil, { recursive: true, force: true });
  } catch {
    /* el perfil temporal puede quedar bloqueado un instante */
  }
}
const todoBien = resultados.length > 0 && resultados.every(Boolean);
console.log(todoBien ? `\nTodas las comprobaciones pasaron (${resultados.length})` : '\nHAY COMPROBACIONES FALLIDAS');
process.exit(todoBien ? 0 : 1);
