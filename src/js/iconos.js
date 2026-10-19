// Íconos de metas y movimientos. El servidor guarda solo un identificador corto (meta_ahorro.icono); aquí se asocia
// a su dibujo y colores. Un identificador desconocido (por ejemplo, de otra versión de la app) cae en el ícono por defecto.

import { crearSvg, el } from './dom.js';

const ICONOS_META = {
  carrito: { etiqueta: 'Mercado', fondo: '#DCFCE7', color: '#16A34A', trazos: ['M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 2m12-2l2 2M9 21a1 1 0 100-2 1 1 0 000 2zm10 0a1 1 0 100-2 1 1 0 000 2z'] },
  libro: { etiqueta: 'Estudio', fondo: '#DBEAFE', color: '#1D4ED8', trazos: ['M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253'] },
  escudo: { etiqueta: 'Emergencia', fondo: '#FEE2E2', color: '#DC2626', trazos: ['M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'] },
  regalo: { etiqueta: 'Regalo', fondo: '#EDE9FE', color: '#7C3AED', trazos: ['M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7'] },
  bicicleta: { etiqueta: 'Transporte', fondo: '#FEF3C7', color: '#B45309', trazos: ['M5 18a3 3 0 100-6 3 3 0 000 6zm14 0a3 3 0 100-6 3 3 0 000 6z', 'M5 15l4-7h5l3 7M9 8l3 7M14 8h2'] },
  casa: { etiqueta: 'Hogar', fondo: '#CCFBF1', color: '#0F766E', trazos: ['M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'] },
  meta: { etiqueta: 'Otra meta', fondo: '#DCFCE7', color: '#16A34A', trazos: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 18a6 6 0 100-12 6 6 0 000 12z', 'M12 14a2 2 0 100-4 2 2 0 000 4z'] },
};

const ICONOS_MOVIMIENTO = {
  DEPOSITO_META: { fondo: '#DCFCE7', color: '#16A34A', trazos: ['M9 11l3-3m0 0l3 3m-3-3v8m0-13a9 9 0 110 18 9 9 0 010-18z'] },
  RETIRO_META: { fondo: '#FEF3C7', color: '#B45309', trazos: ['M15 13l-3 3m0 0l-3-3m3 3V8m0 13a9 9 0 110-18 9 9 0 010 18z'] },
  INGRESO: { fondo: '#DCFCE7', color: '#16A34A', trazos: ['M12 4v16m8-8H4'] },
  EGRESO: { fondo: '#DBEAFE', color: '#1D4ED8', trazos: ['M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'] },
};

const ICONOS_ACCION = {
  nueva: { fondo: '#DCFCE7', color: '#16A34A', trazos: ['M12 4v16m8-8H4'] },
  abonar: { fondo: '#FEF3C7', color: '#F59E0B', trazos: ['M9 11l3-3m0 0l3 3m-3-3v8m0-13a9 9 0 110 18 9 9 0 010-18z'] },
  historial: { fondo: '#DBEAFE', color: '#1D4ED8', trazos: ['M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'] },
  aprender: { fondo: '#EDE9FE', color: '#7C3AED', trazos: ['M12 14l9-5-9-5-9 5 9 5z', 'M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z'] },
};

/** Identificadores de ícono que se pueden elegir al crear una meta, en el orden en que se muestran. */
export const OPCIONES_ICONO_META = Object.keys(ICONOS_META);

const definicionDeMeta = (identificador) => ICONOS_META[identificador] ?? ICONOS_META.meta;

/** Caja de color con el ícono de una meta (clase del prototipo: icon-box). */
export function cajaIconoMeta(identificador, claseTamanio = 'icon-box--md') {
  const definicion = definicionDeMeta(identificador);
  return el('div', { clase: `icon-box ${claseTamanio}`, estilo: { background: definicion.fondo }, attrs: { 'aria-hidden': 'true' } }, crearSvg(definicion.trazos, definicion.color));
}

export function cajaIconoMovimiento(tipo) {
  const definicion = ICONOS_MOVIMIENTO[tipo] ?? ICONOS_MOVIMIENTO.INGRESO;
  return el('div', { clase: 'icon-box icon-box--md', estilo: { background: definicion.fondo }, attrs: { 'aria-hidden': 'true' } }, crearSvg(definicion.trazos, definicion.color));
}

/** Pinta los íconos de los accesos rápidos (elementos con data-icono-accion). */
export function pintarIconosDeAcciones(raiz) {
  for (const caja of raiz.querySelectorAll('[data-icono-accion]')) {
    const definicion = ICONOS_ACCION[caja.dataset.iconoAccion];
    if (definicion && caja.childElementCount === 0) {
      caja.style.background = definicion.fondo;
      caja.append(crearSvg(definicion.trazos, definicion.color));
    }
  }
}

/** Opciones del selector de ícono del formulario de nueva meta (radios accesibles con su etiqueta visible solo al lector). */
export function crearOpcionesDeIcono(contenedor, seleccionado = 'meta') {
  contenedor.replaceChildren();
  for (const identificador of OPCIONES_ICONO_META) {
    const definicion = ICONOS_META[identificador];
    const entrada = el('input', { attrs: { type: 'radio', name: 'icono', value: identificador, checked: identificador === seleccionado } });
    const etiqueta = el(
      'label',
      {},
      entrada,
      el('span', { clase: 'icon-option', estilo: { background: definicion.fondo } }, crearSvg(definicion.trazos, definicion.color, 24)),
      el('span', { clase: 'sr-only', texto: definicion.etiqueta }),
    );
    contenedor.append(etiqueta);
  }
}
