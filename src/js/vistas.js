// Funciones que dibujan las listas y tarjetas de la interfaz a partir de los datos de la API.
// Reglas: (1) todo texto dinámico entra como texto (nunca como HTML); (2) las tarjetas completas son clicables mediante
// un botón real dentro del título (el área de clic se extiende con ::after), por lo que son accesibles con teclado.

import { crearSvg, el, vaciar } from './dom.js';
import { cajaIconoMeta, cajaIconoMovimiento } from './iconos.js';
import { describirEstado, formatearFechaCorta, formatearFechaHora, formatearPesos } from './formato.js';

const COLORES_CATEGORIA = [
  { fondo: '#DCFCE7', color: '#16A34A' },
  { fondo: '#FEE2E2', color: '#DC2626' },
  { fondo: '#DBEAFE', color: '#1D4ED8' },
  { fondo: '#FEF3C7', color: '#B45309' },
  { fondo: '#EDE9FE', color: '#7C3AED' },
  { fondo: '#CCFBF1', color: '#0F766E' },
];

const TRAZO_CALENDARIO = ['M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z', 'M16 2v4M8 2v4M3 10h18'];
const TRAZO_CATEGORIA = ['M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253'];

const barraDeProgreso = (meta, grande) =>
  el(
    'div',
    {
      clase: `progress-bar${grande ? ' progress-bar--lg' : ''}`,
      attrs: { role: 'progressbar', 'aria-valuenow': meta.porcentaje, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${meta.porcentaje}% completado` },
    },
    el('div', { clase: `progress-fill${meta.estado === 'ATRASADA' ? ' progress-fill--warning' : ''}`, estilo: { width: `${meta.porcentaje}%` } }),
  );

/** Tarjeta pequeña del carrusel de la pantalla de inicio. */
export function crearTarjetaMetaInicio(meta, alAbrir) {
  return el(
    'article',
    { clase: 'goal-card card', attrs: { role: 'listitem' } },
    cajaIconoMeta(meta.icono, 'icon-box--sm'),
    el('p', { clase: 'goal-name' }, el('button', { clase: 'card-hit', texto: meta.nombre, attrs: { type: 'button', 'aria-label': `Abrir la meta ${meta.nombre}, ${meta.porcentaje}% completado` }, alClick: () => alAbrir(meta) })),
    el('p', { clase: 'goal-amount', texto: `${formatearPesos(meta.montoAhorrado)} / ${formatearPesos(meta.montoObjetivo)}` }),
    barraDeProgreso(meta, false),
    el('p', { clase: 'goal-pct', texto: `${meta.porcentaje}% completado` }),
  );
}

/** Tarjeta completa de la pantalla "Mis metas". */
export function crearTarjetaMeta(meta, alAbrir) {
  const estado = describirEstado(meta.estado);
  return el(
    'article',
    { clase: 'savings-card card', attrs: { role: 'listitem' } },
    el(
      'div',
      { clase: 'savings-card-header' },
      cajaIconoMeta(meta.icono, 'icon-box--lg'),
      el(
        'div',
        { clase: 'savings-card-info' },
        el('h3', { clase: 'savings-card-name' }, el('button', { clase: 'card-hit', texto: meta.nombre, attrs: { type: 'button', 'aria-label': `Abrir la meta ${meta.nombre}, ${meta.porcentaje}% completado, ${estado.texto}` }, alClick: () => alAbrir(meta) })),
        el('p', { clase: 'savings-card-desc', texto: meta.descripcion ?? '' }),
      ),
    ),
    el('div', { clase: 'savings-progress-row' }, el('span', { clase: 'savings-progress-saved', texto: formatearPesos(meta.montoAhorrado) }), el('span', { clase: 'savings-progress-total', texto: `de ${formatearPesos(meta.montoObjetivo)}` })),
    barraDeProgreso(meta, true),
    el('p', { clase: 'savings-pct', texto: `${meta.porcentaje}% completado` }),
    el(
      'div',
      { clase: 'savings-card-footer' },
      el('span', { clase: 'savings-date' }, crearSvg(TRAZO_CALENDARIO, 'currentColor', 14), formatearFechaCorta(meta.fechaLimite)),
      el('span', { clase: `status-chip ${estado.clase}`, texto: estado.texto }),
    ),
  );
}

const ES_ENTRADA = new Set(['DEPOSITO_META', 'INGRESO']);
const ETIQUETA_TIPO = { DEPOSITO_META: 'Depósito', RETIRO_META: 'Retiro', INGRESO: 'Ingreso', EGRESO: 'Egreso' };

/** Fila del historial de movimientos. */
export function crearItemMovimiento(movimiento, ahora = new Date()) {
  const entrada = ES_ENTRADA.has(movimiento.tipo);
  const importe = `${entrada ? '+' : '−'}${formatearPesos(movimiento.monto)}`;
  const detalle = [formatearFechaHora(movimiento.fecha, ahora), movimiento.nombreMeta].filter(Boolean).join(' · ');
  return el(
    'div',
    { clase: 'tx-item', attrs: { role: 'listitem' } },
    cajaIconoMovimiento(movimiento.tipo),
    el('div', { clase: 'tx-info' }, el('p', { clase: 'tx-name', texto: movimiento.descripcion }), el('p', { clase: 'tx-date', texto: detalle })),
    el('span', { clase: `tx-amount tx-amount--${entrada ? 'positive' : 'negative'}`, texto: importe, attrs: { 'aria-label': `${ETIQUETA_TIPO[movimiento.tipo] ?? 'Movimiento'} de ${formatearPesos(movimiento.monto)}` } }),
  );
}

export function pintarMovimientos(contenedor, movimientos, { vacio, ahora } = {}) {
  vaciar(contenedor);
  contenedor.append(...movimientos.map((movimiento) => crearItemMovimiento(movimiento, ahora)));
  if (vacio) {
    vacio.hidden = movimientos.length > 0;
  }
}

/** Botón de la hoja "¿A qué meta quieres abonar?". */
export function crearOpcionDeMeta(meta, alElegir) {
  return el(
    'button',
    { clase: 'btn btn--ghost btn--block option-row', attrs: { type: 'button' }, alClick: () => alElegir(meta) },
    cajaIconoMeta(meta.icono, 'icon-box--sm'),
    el('span', { clase: 'option-text' }, el('strong', { texto: meta.nombre }), el('small', { texto: `${formatearPesos(meta.montoAhorrado)} de ${formatearPesos(meta.montoObjetivo)}` })),
  );
}

export function crearTarjetaCategoria(categoria, indice, alAbrir) {
  const colores = COLORES_CATEGORIA[indice % COLORES_CATEGORIA.length];
  const total = categoria.totalLecciones;
  return el(
    'button',
    { clase: 'category-card card', attrs: { type: 'button', 'aria-label': `Categoría ${categoria.nombre}, ${total} ${total === 1 ? 'lección' : 'lecciones'}` }, alClick: () => alAbrir(categoria) },
    el('div', { clase: 'icon-box icon-box--md', estilo: { background: colores.fondo }, attrs: { 'aria-hidden': 'true' } }, crearSvg(TRAZO_CATEGORIA, colores.color)),
    el('div', {}, el('p', { clase: 'category-name', texto: categoria.nombre }), el('p', { clase: 'category-count', texto: `${total} ${total === 1 ? 'lección' : 'lecciones'}` })),
  );
}

export function crearItemLeccion(leccion) {
  return el(
    'div',
    { clase: 'lesson-item', attrs: { role: 'listitem' } },
    el('h3', { texto: leccion.titulo }),
    el('p', { texto: leccion.resumen }),
    el('small', { texto: `${leccion.duracionMinutos} min${leccion.esDestacada ? ' · Lección del día' : ''}` }),
  );
}
