// Ayudas para formularios: errores por campo accesibles (aria-invalid + texto asociado) y bloqueo mientras se envía.

const ETIQUETAS_DE_CAMPO = {
  nombres: 'Los nombres',
  apellidos: 'Los apellidos',
  correo: 'El correo',
  contrasena: 'La contraseña',
  nombre: 'El nombre',
  montoObjetivo: 'El monto',
  monto: 'El monto',
  fechaLimite: 'La fecha',
  descripcion: 'El texto',
};

/** Quita todos los errores de campo de un formulario o contenedor. */
export function limpiarErrores(raiz) {
  for (const campo of raiz.querySelectorAll('[aria-invalid]')) {
    campo.removeAttribute('aria-invalid');
  }
  for (const mensaje of raiz.querySelectorAll('.field .error')) {
    mensaje.hidden = true;
    mensaje.textContent = '';
  }
}

/** Marca un campo como inválido y muestra su mensaje (el id del mensaje es `${idCampo}-error`). */
export function marcarError(idCampo, mensaje) {
  const campo = document.getElementById(idCampo);
  const texto = document.getElementById(`${idCampo}-error`);
  if (!campo || !texto) {
    return false;
  }
  campo.setAttribute('aria-invalid', 'true');
  texto.textContent = mensaje;
  texto.hidden = false;
  return true;
}

/**
 * Aplica los errores por campo que devuelve la API ([{ campo, mensaje }]).
 * `correspondencia` traduce el nombre del campo de la API al id del campo de la pantalla.
 * Devuelve true si todos pudieron mostrarse junto a su campo.
 */
export function aplicarDetalles(detalles, correspondencia) {
  let todos = detalles.length > 0;
  for (const { campo, mensaje } of detalles) {
    const etiqueta = ETIQUETAS_DE_CAMPO[campo] ?? 'El dato';
    const idCampo = correspondencia[campo];
    if (!idCampo || !marcarError(idCampo, `${etiqueta} ${mensaje}.`)) {
      todos = false;
    }
  }
  return todos;
}

/** Lleva el foco al primer campo con error para que un lector de pantalla lo anuncie. */
export function enfocarPrimerError(raiz) {
  raiz.querySelector('[aria-invalid="true"]')?.focus();
}

/** Deshabilita los controles mientras se procesa la solicitud (evita envíos dobles) y los vuelve a habilitar. */
export function bloquear(raiz, bloqueado) {
  for (const control of raiz.querySelectorAll('input, textarea, button')) {
    control.disabled = bloqueado;
  }
}

export function mostrarBanner(banner, mensaje) {
  banner.textContent = mensaje;
  banner.hidden = false;
}

export function ocultarBanner(banner) {
  banner.hidden = true;
  banner.textContent = '';
}
