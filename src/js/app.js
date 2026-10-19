// Controlador de la interfaz de GKMF (Fase III): navegación, sesión y las operaciones de metas y movimientos.
//
// Estructura:  api.js (HTTP + tokens en memoria)  ->  este archivo (estado y eventos)  ->  vistas.js (DOM).
// No hay scripts ni manejadores en línea en el HTML: todo se engancha aquí con addEventListener, lo que permite una
// política de seguridad de contenido (CSP) estricta con `script-src 'self'`.

import { crearClienteApi, ErrorApi } from './api.js';
import { mostrar, vaciar } from './dom.js';
import { aplicarDetalles, bloquear, enfocarPrimerError, limpiarErrores, marcarError, mostrarBanner, ocultarBanner } from './formularios.js';
import { coincideConFiltro, describirEstado, formatearFechaCorta, formatearMesYAnio, formatearPesos, formatearPesosCompacto, formatearVariacion, hoyLocal, iniciales, parsearMonto, primerNombre, saludoSegunHora } from './formato.js';
import { abrirHoja, activarCierreDeHojas, bloquearCierreDeHojas, cerrarHoja, mostrarAviso } from './hojas.js';
import { crearOpcionesDeIcono, pintarIconosDeAcciones } from './iconos.js';
import { crearOpcionDeMeta, crearItemLeccion, crearTarjetaCategoria, crearTarjetaMeta, crearTarjetaMetaInicio, pintarMovimientos } from './vistas.js';

const DURACION_SPLASH_MS = 2200;
const MOVIMIENTOS_POR_PAGINA = 15;
const DIAS_META_POR_DEFECTO = 30;
const INDICE_NAVEGACION = { dashboard: 0, savings: 1, education: 2, profile: 3 };
const $ = (id) => document.getElementById(id);

const baseApi = document.querySelector('meta[name="gkmf-api-base"]')?.content ?? 'http://localhost:3000';
const api = crearClienteApi({ base: baseApi, alSesionExpirada: () => volverAlAcceso('Tu sesión expiró. Inicia sesión de nuevo.') });

const estado = {
  usuario: null,
  metas: [],
  resumen: null,
  recientes: [],
  filtro: 'todas',
  historial: { items: [], pagina: 0, totalPaginas: 0 },
  categorias: null,
  metaActiva: null,
  modo: 'deposito',
  codigoMeta: null,
  codigoMovimiento: null,
  origenHoja: null,
  /** Cambia al cerrar sesión: una respuesta que llega tarde de la sesión anterior se descarta en lugar de pintarse. */
  generacion: 0,
};

// ─── Mensajes de error ──────────────────────────────────────────────────────────────────────────────────────────
const mensajeDe = (error) => (error instanceof ErrorApi ? error.mensaje : 'Ocurrió un error inesperado. Inténtalo de nuevo.');

// ─── Navegación ─────────────────────────────────────────────────────────────────────────────────────────────────
let pantallaActual = 'splash';

function irA(nombre) {
  for (const pantalla of document.querySelectorAll('.screen')) {
    const activa = pantalla.id === nombre;
    pantalla.classList.toggle('active', activa);
    pantalla.inert = !activa;
    if (activa) {
      pantalla.removeAttribute('aria-hidden');
      pantalla.querySelector('.scroll-content')?.scrollTo({ top: 0 });
    } else {
      pantalla.setAttribute('aria-hidden', 'true');
    }
  }
  const navegacion = $('main-nav');
  const principal = Object.hasOwn(INDICE_NAVEGACION, nombre);
  navegacion.hidden = !principal;
  navegacion.querySelectorAll('.nav-item').forEach((boton, indice) => {
    const activo = principal && indice === INDICE_NAVEGACION[nombre];
    boton.classList.toggle('active', activo);
    activo ? boton.setAttribute('aria-current', 'page') : boton.removeAttribute('aria-current');
  });
  pantallaActual = nombre;
  alEntrarEnPantalla(nombre);
}

function alEntrarEnPantalla(nombre) {
  if (!estado.usuario) {
    return;
  }
  if (nombre === 'dashboard' || nombre === 'savings') {
    void refrescarDatos();
  } else if (nombre === 'movements') {
    void cargarHistorial(true);
  } else if (nombre === 'education') {
    void cargarEducacion();
  } else if (nombre === 'profile') {
    pintarPerfil();
  }
}

// ─── Datos del usuario: carga y pintado ─────────────────────────────────────────────────────────────────────────
async function refrescarDatos() {
  const generacion = estado.generacion;
  try {
    const [respuestaMetas, respuestaMovimientos] = await Promise.all([api.listarMetas(), api.listarMovimientos({ limite: 5 })]);
    if (generacion !== estado.generacion) {
      return; // la sesión cambió mientras se esperaba: estos datos son de otra persona
    }
    estado.metas = respuestaMetas.datos;
    estado.resumen = respuestaMetas.resumen;
    estado.recientes = respuestaMovimientos.datos;
    ocultarBanner($('inicio-error'));
    ocultarBanner($('metas-error'));
  } catch (error) {
    if (generacion !== estado.generacion) {
      return;
    }
    mostrarBanner($('inicio-error'), mensajeDe(error));
    mostrarBanner($('metas-error'), mensajeDe(error));
    return;
  }
  pintarInicio();
  pintarMetas();
  pintarPerfil();
}

function pintarInicio() {
  const { usuario, resumen, metas, recientes } = estado;
  $('saludo').textContent = `${saludoSegunHora()},`;
  $('nombre-usuario').textContent = primerNombre(usuario.nombres);
  $('iniciales').textContent = iniciales(usuario.nombres, usuario.apellidos);
  $('total-ahorrado').textContent = formatearPesos(resumen.totalAhorrado);
  $('neto-mes').textContent = formatearVariacion(resumen.netoEsteMes);
  $('n-activas').textContent = String(resumen.metasActivas);
  $('n-completadas').textContent = String(resumen.metasCompletadas);

  const activas = metas.filter((meta) => coincideConFiltro(meta, 'progreso')).slice(0, 6);
  const carrusel = vaciar($('metas-inicio'));
  carrusel.append(...activas.map((meta) => crearTarjetaMetaInicio(meta, abrirDetalleMeta)));
  mostrar($('metas-inicio'), activas.length > 0);
  mostrar($('metas-inicio-vacio'), metas.length === 0);
  pintarMovimientos($('movimientos-inicio'), recientes, { vacio: $('movimientos-inicio-vacio') });
}

function pintarMetas() {
  const { resumen, metas, filtro } = estado;
  $('stat-activas').textContent = String(resumen.metasActivas);
  $('stat-promedio').textContent = `${resumen.promedioProgreso}%`;
  $('stat-ahorrado').textContent = formatearPesosCompacto(resumen.totalAhorrado);
  const visibles = metas.filter((meta) => coincideConFiltro(meta, filtro));
  vaciar($('lista-metas')).append(...visibles.map((meta) => crearTarjetaMeta(meta, abrirDetalleMeta)));
  const vacio = $('metas-vacio');
  vacio.hidden = visibles.length > 0;
  if (visibles.length === 0) {
    vacio.textContent = metas.length === 0 ? 'Aún no tienes metas. Toca «+ Nueva» para crear la primera.' : 'No hay metas en esta categoría.';
  }
}

function pintarPerfil() {
  const { usuario, resumen } = estado;
  if (!usuario || !resumen) {
    return;
  }
  $('perfil-iniciales').textContent = iniciales(usuario.nombres, usuario.apellidos);
  $('perfil-nombre').textContent = `${usuario.nombres} ${usuario.apellidos}`;
  $('perfil-desde').textContent = `Miembro desde ${formatearMesYAnio(usuario.fechaRegistro)}`;
  $('perfil-correo').textContent = usuario.correo;
  $('perfil-total').textContent = formatearPesos(resumen.totalAhorrado);
  $('perfil-activas').textContent = String(resumen.metasActivas);
  $('perfil-completadas').textContent = String(resumen.metasCompletadas);
}

async function cargarHistorial(reiniciar) {
  const historial = estado.historial;
  const siguiente = reiniciar ? 1 : historial.pagina + 1;
  try {
    const respuesta = await api.listarMovimientos({ pagina: siguiente, limite: MOVIMIENTOS_POR_PAGINA });
    estado.historial = {
      items: reiniciar ? respuesta.datos : [...historial.items, ...respuesta.datos],
      pagina: respuesta.paginacion.pagina,
      totalPaginas: respuesta.paginacion.totalPaginas,
    };
    ocultarBanner($('movimientos-error'));
  } catch (error) {
    mostrarBanner($('movimientos-error'), mensajeDe(error));
    return;
  }
  pintarMovimientos($('lista-movimientos'), estado.historial.items, { vacio: $('movimientos-vacio') });
  mostrar(document.querySelector('[data-accion="mas-movimientos"]'), estado.historial.pagina < estado.historial.totalPaginas);
}

async function cargarEducacion() {
  if (estado.categorias) {
    return;
  }
  try {
    estado.categorias = (await api.listarCategorias()).datos;
    ocultarBanner($('educacion-error'));
  } catch (error) {
    mostrarBanner($('educacion-error'), mensajeDe(error));
    return;
  }
  vaciar($('lista-categorias')).append(...estado.categorias.map((categoria, indice) => crearTarjetaCategoria(categoria, indice, abrirLecciones)));
}

async function abrirLecciones(categoria) {
  $('titulo-lecciones').textContent = categoria.nombre;
  vaciar($('lista-lecciones'));
  ocultarBanner($('lecciones-error'));
  abrirHoja($('hoja-lecciones'));
  try {
    const { datos } = await api.listarLecciones(categoria.id);
    if ($('titulo-lecciones').textContent !== categoria.nombre) {
      return; // se abrió otra categoría mientras tanto
    }
    $('lista-lecciones').append(...datos.map(crearItemLeccion));
  } catch (error) {
    mostrarBanner($('lecciones-error'), mensajeDe(error));
  }
}

// ─── Sesión ─────────────────────────────────────────────────────────────────────────────────────────────────────
function mostrarAcceso(aviso) {
  limpiarErrores($('auth'));
  seleccionarPestana('login');
  const banner = $('auth-aviso');
  aviso ? mostrarBanner(banner, aviso) : ocultarBanner(banner);
  irA('auth');
}

/** Descarta todo lo del usuario anterior (datos en memoria y listas pintadas) antes de volver a la pantalla de acceso. */
function volverAlAcceso(aviso) {
  estado.generacion += 1;
  cerrarHoja();
  Object.assign(estado, { usuario: null, metas: [], resumen: null, recientes: [], historial: { items: [], pagina: 0, totalPaginas: 0 }, categorias: null, metaActiva: null });
  for (const id of ['metas-inicio', 'movimientos-inicio', 'lista-metas', 'lista-movimientos', 'lista-categorias', 'lista-lecciones']) {
    vaciar($(id));
  }
  for (const formulario of document.querySelectorAll('#auth form')) {
    formulario.reset();
  }
  for (const casilla of document.querySelectorAll('[data-mostrar-clave]')) {
    $(casilla.dataset.mostrarClave).type = 'password'; // reset() desmarca la casilla pero no devuelve el tipo del campo
  }
  mostrarAcceso(aviso);
}

async function alIniciarSesion(usuario) {
  estado.usuario = usuario;
  ocultarBanner($('auth-aviso'));
  irA('dashboard');
}

function seleccionarPestana(nombre) {
  for (const pestana of document.querySelectorAll('.seg-tab')) {
    const activa = pestana.dataset.tab === nombre;
    pestana.setAttribute('aria-selected', String(activa));
    pestana.tabIndex = activa ? 0 : -1;
  }
  mostrar($('panel-login'), nombre === 'login');
  mostrar($('panel-registro'), nombre === 'registro');
}

async function enviarLogin(evento) {
  evento.preventDefault();
  const formulario = evento.currentTarget;
  limpiarErrores(formulario);
  ocultarBanner($('auth-aviso'));
  const correo = $('login-correo').value.trim();
  const contrasena = $('login-contrasena').value;
  if (!correo) {
    marcarError('login-correo', 'Escribe tu correo.');
  }
  if (!contrasena) {
    marcarError('login-contrasena', 'Escribe tu contraseña.');
  }
  if (!correo || !contrasena) {
    enfocarPrimerError(formulario);
    return;
  }
  bloquear(formulario, true);
  bloquearCierreDeHojas(true);
  try {
    await alIniciarSesion(await api.iniciarSesion(correo, contrasena));
    formulario.reset();
  } catch (error) {
    mostrarBanner($('auth-aviso'), mensajeDe(error));
  } finally {
    bloquear(formulario, false);
    bloquearCierreDeHojas(false);
  }
}

const CAMPOS_REGISTRO = { nombres: 'registro-nombres', apellidos: 'registro-apellidos', correo: 'registro-correo', contrasena: 'registro-contrasena' };

async function enviarRegistro(evento) {
  evento.preventDefault();
  const formulario = evento.currentTarget;
  limpiarErrores(formulario);
  ocultarBanner($('auth-aviso'));
  const datos = { nombres: $('registro-nombres').value.trim(), apellidos: $('registro-apellidos').value.trim(), correo: $('registro-correo').value.trim(), contrasena: $('registro-contrasena').value };
  if (!datos.nombres) marcarError('registro-nombres', 'Escribe tus nombres.');
  if (!datos.apellidos) marcarError('registro-apellidos', 'Escribe tus apellidos.');
  if (!datos.correo) marcarError('registro-correo', 'Escribe tu correo.');
  if (datos.contrasena.length < 12) marcarError('registro-contrasena', 'La contraseña debe tener al menos 12 caracteres.');
  if (formulario.querySelector('[aria-invalid="true"]')) {
    enfocarPrimerError(formulario);
    return;
  }
  bloquear(formulario, true);
  bloquearCierreDeHojas(true);
  try {
    await api.registrar(datos);
    await alIniciarSesion(await api.iniciarSesion(datos.correo, datos.contrasena));
    formulario.reset();
  } catch (error) {
    if (error instanceof ErrorApi && error.codigo === 'CORREO_YA_REGISTRADO') {
      marcarError('registro-correo', 'Ya existe una cuenta con ese correo. Inicia sesión o usa otro.');
    } else if (!(error instanceof ErrorApi && error.estado === 400 && aplicarDetalles(error.detalles, CAMPOS_REGISTRO))) {
      mostrarBanner($('auth-aviso'), mensajeDe(error));
    }
    setTimeout(() => enfocarPrimerError(formulario), 0); // después del finally: con el formulario aún deshabilitado .focus() no hace nada
  } finally {
    bloquear(formulario, false);
    bloquearCierreDeHojas(false);
  }
}

async function cerrarSesion() {
  // api.cerrarSesion olvida los tokens al instante; la interfaz se limpia sin esperar la respuesta de la red.
  const revocacion = api.cerrarSesion();
  volverAlAcceso();
  await revocacion;
}

// ─── Nueva meta ─────────────────────────────────────────────────────────────────────────────────────────────────
const CAMPOS_META = { nombre: 'meta-nombre', montoObjetivo: 'meta-objetivo', fechaLimite: 'meta-fecha', descripcion: 'meta-descripcion' };

function sumarDias(fechaIso, dias) {
  const [anio, mes, dia] = fechaIso.split('-').map(Number);
  return hoyLocal(new Date(anio, mes - 1, dia + dias));
}

function abrirNuevaMeta(origen) {
  const formulario = $('form-meta-nueva');
  formulario.reset();
  limpiarErrores(formulario);
  ocultarBanner($('meta-nueva-aviso'));
  const hoy = hoyLocal();
  $('meta-fecha').min = hoy;
  $('meta-fecha').value = sumarDias(hoy, DIAS_META_POR_DEFECTO);
  crearOpcionesDeIcono($('selector-iconos'), 'meta');
  // Un código por intento: si la respuesta se pierde y se reintenta, el servidor reconoce la solicitud y no duplica la meta.
  estado.codigoMeta = crypto.randomUUID();
  abrirHoja($('hoja-meta-nueva'), origen);
}

async function enviarNuevaMeta(evento) {
  evento.preventDefault();
  const formulario = evento.currentTarget;
  limpiarErrores(formulario);
  ocultarBanner($('meta-nueva-aviso'));
  const nombre = $('meta-nombre').value.trim();
  const monto = parsearMonto($('meta-objetivo').value);
  const fecha = $('meta-fecha').value;
  if (!nombre) marcarError('meta-nombre', 'Cuéntanos para qué quieres ahorrar.');
  if (monto === null) marcarError('meta-objetivo', 'Escribe un monto válido, por ejemplo 250.000.');
  if (!fecha) marcarError('meta-fecha', 'Elige una fecha límite.');
  if (formulario.querySelector('[aria-invalid="true"]')) {
    enfocarPrimerError(formulario);
    return;
  }
  const descripcion = $('meta-descripcion').value.trim();
  const icono = formulario.querySelector('input[name="icono"]:checked')?.value ?? 'meta';
  bloquear(formulario, true);
  bloquearCierreDeHojas(true);
  try {
    await api.crearMeta({ nombre, montoObjetivo: monto, fechaLimite: fecha, icono, codigoGlobal: estado.codigoMeta, ...(descripcion ? { descripcion } : {}) });
    cerrarHoja();
    mostrarAviso('Meta creada. ¡A ahorrar!');
    await refrescarDatos();
  } catch (error) {
    if (!(error instanceof ErrorApi && error.estado === 400 && aplicarDetalles(error.detalles, CAMPOS_META))) {
      mostrarBanner($('meta-nueva-aviso'), mensajeDe(error));
    }
    setTimeout(() => enfocarPrimerError(formulario), 0); // después del finally: con el formulario aún deshabilitado .focus() no hace nada
  } finally {
    bloquear(formulario, false);
    bloquearCierreDeHojas(false);
  }
}

// ─── Detalle de una meta y movimientos ──────────────────────────────────────────────────────────────────────────
async function abrirDetalleMeta(meta) {
  estado.metaActiva = meta;
  estado.origenHoja = document.activeElement;
  $('titulo-meta-detalle').textContent = meta.nombre;
  const barra = $('detalle-barra');
  barra.setAttribute('aria-valuenow', String(meta.porcentaje));
  barra.setAttribute('aria-label', `${meta.porcentaje}% completado`);
  $('detalle-relleno').style.width = `${meta.porcentaje}%`;
  $('detalle-ahorrado').textContent = formatearPesos(meta.montoAhorrado);
  $('detalle-objetivo').textContent = formatearPesos(meta.montoObjetivo);
  $('detalle-falta').textContent = formatearPesos(Math.max(0, meta.montoObjetivo - meta.montoAhorrado));
  $('detalle-fecha').textContent = formatearFechaCorta(meta.fechaLimite);
  $('detalle-estado').textContent = describirEstado(meta.estado).texto;
  $('btn-abonar').disabled = meta.estado === 'COMPLETADA' || meta.estado === 'PAUSADA';
  $('btn-retirar').disabled = meta.montoAhorrado <= 0;
  vaciar($('detalle-movimientos'));
  $('detalle-movimientos-vacio').hidden = true;
  abrirHoja($('hoja-meta-detalle'), estado.origenHoja);
  try {
    const { datos } = await api.listarMovimientos({ idMeta: meta.id, limite: 5 });
    if (estado.metaActiva?.id !== meta.id) {
      return; // se abrió otra meta mientras tanto: estos movimientos no son de la que se está viendo
    }
    pintarMovimientos($('detalle-movimientos'), datos, { vacio: $('detalle-movimientos-vacio') });
  } catch (error) {
    mostrarAviso(mensajeDe(error));
  }
}

function abrirMovimiento(modo, meta) {
  estado.modo = modo;
  estado.metaActiva = meta;
  const formulario = $('form-movimiento');
  formulario.reset();
  limpiarErrores(formulario);
  ocultarBanner($('movimiento-aviso'));
  $('titulo-movimiento').textContent = modo === 'deposito' ? `Abonar a ${meta.nombre}` : `Retirar de ${meta.nombre}`;
  $('movimiento-contexto').textContent = modo === 'deposito' ? `Llevas ${formatearPesos(meta.montoAhorrado)} de ${formatearPesos(meta.montoObjetivo)}.` : `Saldo disponible en esta meta: ${formatearPesos(meta.montoAhorrado)}.`;
  $('movimiento-enviar').textContent = modo === 'deposito' ? 'Confirmar abono' : 'Confirmar retiro';
  estado.codigoMovimiento = crypto.randomUUID();
  abrirHoja($('hoja-movimiento'), estado.origenHoja);
}

const CAMPOS_MOVIMIENTO = { monto: 'movimiento-monto', descripcion: 'movimiento-descripcion' };

async function enviarMovimiento(evento) {
  evento.preventDefault();
  const formulario = evento.currentTarget;
  limpiarErrores(formulario);
  ocultarBanner($('movimiento-aviso'));
  const monto = parsearMonto($('movimiento-monto').value);
  if (monto === null) {
    marcarError('movimiento-monto', 'Escribe un monto válido, por ejemplo 20.000.');
    enfocarPrimerError(formulario);
    return;
  }
  const meta = estado.metaActiva;
  if (estado.modo === 'retiro' && monto > meta.montoAhorrado) {
    marcarError('movimiento-monto', `Solo tienes ${formatearPesos(meta.montoAhorrado)} en esta meta.`);
    enfocarPrimerError(formulario);
    return;
  }
  const nota = $('movimiento-descripcion').value.trim();
  const datos = { monto, codigoGlobal: estado.codigoMovimiento, ...(nota ? { descripcion: nota } : {}) };
  bloquear(formulario, true);
  bloquearCierreDeHojas(true);
  try {
    const operacion = estado.modo === 'deposito' ? api.depositar : api.retirar;
    await operacion(meta.id, datos);
    cerrarHoja();
    mostrarAviso(estado.modo === 'deposito' ? 'Abono registrado.' : 'Retiro registrado.');
    await refrescarDatos();
    if (pantallaActual === 'movements') {
      await cargarHistorial(true);
    }
  } catch (error) {
    if (error instanceof ErrorApi && error.codigo === 'CODIGO_GLOBAL_EN_USO') {
      mostrarBanner($('movimiento-aviso'), 'Esta operación ya se había registrado. Revisa tu historial antes de repetirla.');
      void refrescarDatos();
    } else if (!(error instanceof ErrorApi && error.estado === 400 && aplicarDetalles(error.detalles, CAMPOS_MOVIMIENTO))) {
      mostrarBanner($('movimiento-aviso'), mensajeDe(error));
    }
    setTimeout(() => enfocarPrimerError(formulario), 0); // después del finally: con el formulario aún deshabilitado .focus() no hace nada
  } finally {
    bloquear(formulario, false);
    bloquearCierreDeHojas(false);
  }
}

/** "Abonar a meta" desde el inicio: si hay una sola meta activa se abre directo; si hay varias, se elige una. */
function abonarDesdeInicio(origen) {
  const abonables = estado.metas.filter((meta) => meta.estado === 'EN_PROGRESO' || meta.estado === 'ATRASADA');
  if (abonables.length === 0) {
    mostrarAviso(estado.metas.length === 0 ? 'Primero crea una meta para poder abonar.' : 'No tienes metas abiertas para abonar.');
    return;
  }
  estado.origenHoja = origen;
  if (abonables.length === 1) {
    abrirMovimiento('deposito', abonables[0]);
    return;
  }
  vaciar($('lista-elegir-meta')).append(...abonables.map((meta) => crearOpcionDeMeta(meta, (elegida) => abrirMovimiento('deposito', elegida))));
  abrirHoja($('hoja-elegir-meta'), origen);
}

// ─── Enlace de eventos ──────────────────────────────────────────────────────────────────────────────────────────
function enlazarEventos() {
  document.addEventListener('click', (evento) => {
    const destino = evento.target instanceof Element ? evento.target : null;
    const navegar = destino?.closest('[data-ir]');
    if (navegar) {
      irA(navegar.dataset.ir);
      return;
    }
    const filtro = destino?.closest('[data-filtro]');
    if (filtro) {
      estado.filtro = filtro.dataset.filtro;
      for (const chip of document.querySelectorAll('[data-filtro]')) {
        const activo = chip === filtro;
        chip.classList.toggle('active', activo);
        chip.setAttribute('aria-pressed', String(activo));
      }
      pintarMetas();
      return;
    }
    const pestana = destino?.closest('.seg-tab');
    if (pestana) {
      seleccionarPestana(pestana.dataset.tab);
      limpiarErrores($('auth'));
      ocultarBanner($('auth-aviso'));
      return;
    }
    const accion = destino?.closest('[data-accion]');
    if (!accion) {
      return;
    }
    switch (accion.dataset.accion) {
      case 'nueva-meta':
        abrirNuevaMeta(accion);
        break;
      case 'abonar-rapido':
        abonarDesdeInicio(accion);
        break;
      case 'cerrar-hoja':
        cerrarHoja();
        break;
      case 'abonar':
        abrirMovimiento('deposito', estado.metaActiva);
        break;
      case 'retirar':
        abrirMovimiento('retiro', estado.metaActiva);
        break;
      case 'mas-movimientos':
        void cargarHistorial(false);
        break;
      case 'cerrar-sesion':
        void cerrarSesion();
        break;
      default:
    }
  });

  document.addEventListener('change', (evento) => {
    const casilla = evento.target instanceof HTMLInputElement ? evento.target.closest('[data-mostrar-clave]') : null;
    if (casilla) {
      $(casilla.dataset.mostrarClave).type = casilla.checked ? 'text' : 'password';
    }
  });

  $('panel-login').addEventListener('submit', enviarLogin);
  $('panel-registro').addEventListener('submit', enviarRegistro);
  $('form-meta-nueva').addEventListener('submit', enviarNuevaMeta);
  $('form-movimiento').addEventListener('submit', enviarMovimiento);
  activarCierreDeHojas();
}

// ─── Arranque ───────────────────────────────────────────────────────────────────────────────────────────────────
function iniciar() {
  for (const pantalla of document.querySelectorAll('.screen:not(.active)')) {
    pantalla.inert = true;
    pantalla.setAttribute('aria-hidden', 'true');
  }
  pintarIconosDeAcciones(document);
  enlazarEventos();
  setTimeout(() => mostrarAcceso(), DURACION_SPLASH_MS);
}

iniciar();
