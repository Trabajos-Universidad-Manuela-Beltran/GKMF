// Hojas modales dentro del teléfono y avisos breves.
//
// Los <dialog> se abren con show() (no showModal()) para que queden DENTRO del marco del teléfono; por eso el
// comportamiento modal se completa a mano: el resto de la pantalla se marca `inert` (no recibe foco ni clics), el foco
// pasa a la hoja y vuelve al botón que la abrió al cerrarla, y la tecla Esc o un clic fuera de la hoja la cierran.

const SELECTOR_FONDO = '.screen, #main-nav';
const DURACION_AVISO_MS = 3500;

let hojaAbierta = null;
let disparador = null;
let inertesAntes = new Map();
let temporizadorAviso;
let cierreBloqueado = false;

function cerrar() {
  if (!hojaAbierta) {
    return;
  }
  hojaAbierta.close();
  for (const [nodo, estabaInerte] of inertesAntes) {
    nodo.inert = estabaInerte;
  }
  inertesAntes = new Map();
  hojaAbierta = null;
  disparador?.focus();
  disparador = null;
}

/** Abre una hoja; `origen` es el elemento que recibirá el foco al cerrarla. */
export function abrirHoja(hoja, origen = document.activeElement) {
  cerrar();
  hojaAbierta = hoja;
  disparador = origen instanceof HTMLElement ? origen : null;
  inertesAntes = new Map([...document.querySelectorAll(SELECTOR_FONDO)].map((nodo) => [nodo, nodo.inert]));
  for (const nodo of inertesAntes.keys()) {
    nodo.inert = true;
  }
  hoja.show();
  const primero = hoja.querySelector('input:not([type="radio"]):not(:disabled), textarea, select') ?? hoja.querySelector('button:not(.sheet-close):not(:disabled)') ?? hoja.querySelector('.sheet-close');
  primero?.focus();
}

export function cerrarHoja() {
  cerrar();
}

export function hayHojaAbierta() {
  return hojaAbierta !== null;
}

/**
 * Mientras un formulario se está enviando no se puede cerrar la hoja con Esc ni con un clic en el fondo: si se cerrara y se
 * reabriera, se generaría un código de operación nuevo y un reintento del mismo abono se registraría dos veces.
 */
export function bloquearCierreDeHojas(bloqueado) {
  cierreBloqueado = bloqueado;
}

/** Esc cierra la hoja; un clic sobre el fondo oscuro (fuera del panel) también. */
export function activarCierreDeHojas() {
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && hojaAbierta && !cierreBloqueado) {
      evento.preventDefault();
      cerrar();
    }
  });
  document.addEventListener('click', (evento) => {
    if (hojaAbierta && !cierreBloqueado && evento.target === hojaAbierta) {
      cerrar();
    }
  });
}

/** Aviso breve de confirmación (región aria-live="polite" del HTML). */
export function mostrarAviso(texto) {
  const aviso = document.getElementById('aviso');
  aviso.textContent = texto;
  aviso.classList.add('visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => aviso.classList.remove('visible'), DURACION_AVISO_MS);
}
