// Utilidades para construir el DOM sin innerHTML: todo texto dinámico se inserta como TEXTO (textContent), de modo que
// aunque un dato contenga "<script>" se muestra tal cual y nunca se interpreta como marcado (defensa contra XSS).

const ESPACIO_SVG = 'http://www.w3.org/2000/svg';

/**
 * Crea un elemento.
 *  props.clase    -> className
 *  props.texto    -> textContent
 *  props.attrs    -> atributos (aria-*, data-*, type...) ; un valor null/undefined/false omite el atributo
 *  props.estilo   -> propiedades CSS asignadas por CSSOM (permitido por una CSP sin 'unsafe-inline' para atributos style)
 *  props.alClick  -> manejador de click
 */
export function el(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  if (props.clase) {
    nodo.className = props.clase;
  }
  if (props.texto !== undefined) {
    nodo.textContent = props.texto;
  }
  for (const [nombre, valor] of Object.entries(props.attrs ?? {})) {
    if (valor !== null && valor !== undefined && valor !== false) {
      nodo.setAttribute(nombre, valor === true ? '' : String(valor));
    }
  }
  Object.assign(nodo.style, props.estilo ?? {});
  if (props.alClick) {
    nodo.addEventListener('click', props.alClick);
  }
  nodo.append(...hijos.filter((hijo) => hijo !== null && hijo !== undefined));
  return nodo;
}

/** Dibuja un ícono de trazos (uno o varios paths) con el estilo del prototipo. */
export function crearSvg(trazos, color = 'currentColor', tamanio = 20) {
  const svg = document.createElementNS(ESPACIO_SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', color);
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', String(tamanio));
  svg.setAttribute('height', String(tamanio));
  for (const d of Array.isArray(trazos) ? trazos : [trazos]) {
    const trazo = document.createElementNS(ESPACIO_SVG, 'path');
    trazo.setAttribute('d', d);
    svg.append(trazo);
  }
  return svg;
}

/** Vacía un contenedor. */
export function vaciar(nodo) {
  nodo.replaceChildren();
  return nodo;
}

/** Muestra u oculta un elemento con el atributo hidden. */
export function mostrar(nodo, visible) {
  nodo.hidden = !visible;
}
