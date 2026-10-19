// Funciones puras de formato y lectura de datos de la interfaz. No tocan el DOM: se prueban con `node --test`.

const MENOS = '−'; // signo menos tipográfico (no el guion)
const MONTO_MAXIMO = 100_000_000_000; // el mismo tope que valida la API

/**
 * Pesos colombianos sin decimales cuando son enteros: 72000 -> "$72.000"; 1500.5 -> "$1.500,50".
 * Los negativos usan el signo menos tipográfico.
 */
export function formatearPesos(valor) {
  const numero = Number(valor);
  const absoluto = Math.abs(numero);
  const entero = Number.isInteger(absoluto);
  const texto = absoluto.toLocaleString('es-CO', {
    minimumFractionDigits: entero ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${numero < 0 ? MENOS : ''}$${texto}`;
}

/** Con signo explícito para variaciones: +$32.000 / −$5.000 / $0. */
export function formatearVariacion(valor) {
  if (valor === 0) {
    return '$0';
  }
  return `${valor > 0 ? '+' : ''}${formatearPesos(valor)}`;
}

/** Versión corta para espacios pequeños: 202000 -> "$202K"; 1250000 -> "$1,3M". */
export function formatearPesosCompacto(valor) {
  const absoluto = Math.abs(valor);
  if (absoluto >= 999_500) {
    return `$${(valor / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })}M`;
  }
  if (absoluto >= 1_000) {
    return `$${Math.round(valor / 1_000).toLocaleString('es-CO')}K`;
  }
  return formatearPesos(valor);
}

/**
 * Separa un monto escrito a mano en parte entera y decimales, o devuelve null si su forma no es válida.
 * La API admite como máximo 2 decimales, así que un separador seguido de exactamente 3 dígitos es siempre de miles
 * ("50.000" y "50,000" son cincuenta mil) y uno seguido de 1 o 2 dígitos es decimal ("50,5" es 50,50).
 * Los separadores de miles deben ser de un solo tipo y agrupar de a tres dígitos ("12,345,67" no es válido).
 */
function separarMonto(texto) {
  const ultimo = Math.max(texto.lastIndexOf('.'), texto.lastIndexOf(','));
  if (ultimo === -1) {
    return { entero: texto, decimales: '' };
  }
  const separador = texto[ultimo];
  const otro = separador === '.' ? ',' : '.';
  const cabeza = texto.slice(0, ultimo);
  const cola = texto.slice(ultimo + 1);
  if (cola.length >= 1 && cola.length <= 2 && !cabeza.includes(separador)) {
    return { entero: cabeza, decimales: cola };
  }
  if (cola.length === 3 && !cabeza.includes(otro)) {
    return { entero: texto, decimales: '' };
  }
  return null;
}

const AGRUPACION_CON_PUNTOS = /^[1-9]\d{0,2}(\.\d{3})+$/;
const AGRUPACION_CON_COMAS = /^[1-9]\d{0,2}(,\d{3})+$/;

/** Lee un monto escrito por una persona (formato colombiano o anglosajón) y lo devuelve como número, o null. */
export function parsearMonto(texto) {
  if (typeof texto !== 'string') {
    return null;
  }
  const limpio = texto.replace(/[\s$]/g, '');
  if (!/^[\d.,]+$/.test(limpio)) {
    return null;
  }
  const partes = separarMonto(limpio);
  if (!partes) {
    return null;
  }
  const { entero, decimales } = partes;
  const agrupadoCorrecto = /^\d+$/.test(entero) || AGRUPACION_CON_PUNTOS.test(entero) || AGRUPACION_CON_COMAS.test(entero);
  if (!agrupadoCorrecto) {
    return null;
  }
  const numero = Number(`${entero.replace(/[.,]/g, '')}${decimales ? `.${decimales}` : ''}`);
  return Number.isFinite(numero) && numero > 0 && numero <= MONTO_MAXIMO ? numero : null;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-12-30" -> "30 dic 2026" (sin convertir zonas horarias: es una fecha de calendario). */
export function formatearFechaCorta(iso) {
  const [anio, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return `${dia} ${MESES_CORTOS[mes - 1]} ${anio}`;
}

/** "2026-09-18T..." -> "septiembre de 2026". */
export function formatearMesYAnio(iso) {
  const fecha = new Date(iso);
  return `${MESES_LARGOS[fecha.getMonth()]} de ${fecha.getFullYear()}`;
}

const aDiaLocal = (fecha) => `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;

/** Fecha de hoy en la zona horaria del dispositivo como AAAA-MM-DD (para el mínimo del campo de fecha). */
export function hoyLocal(ahora = new Date()) {
  return aDiaLocal(ahora);
}

function formatearHora(fecha) {
  const horas = fecha.getHours();
  const minutos = String(fecha.getMinutes()).padStart(2, '0');
  return `${horas % 12 === 0 ? 12 : horas % 12}:${minutos} ${horas < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Instante en lenguaje cotidiano: "Hoy, 10:32 a. m." / "Ayer, 8:15 p. m." / "12 oct, 3:05 p. m.". */
export function formatearFechaHora(iso, ahora = new Date()) {
  const fecha = new Date(iso);
  const ayer = new Date(ahora);
  ayer.setDate(ahora.getDate() - 1);
  let dia;
  if (aDiaLocal(fecha) === aDiaLocal(ahora)) {
    dia = 'Hoy';
  } else if (aDiaLocal(fecha) === aDiaLocal(ayer)) {
    dia = 'Ayer';
  } else {
    dia = `${fecha.getDate()} ${MESES_CORTOS[fecha.getMonth()]}`;
  }
  return `${dia}, ${formatearHora(fecha)}`;
}

/** Iniciales para el avatar: "Ana María" + "Pérez Gómez" -> "AP". */
export function iniciales(nombres, apellidos) {
  const primera = (texto) => (texto.trim().match(/\p{L}/u) ?? [''])[0].toUpperCase();
  return `${primera(nombres)}${primera(apellidos)}`;
}

/** Primer nombre para saludar: "Ana María" -> "Ana". */
export function primerNombre(nombres) {
  return nombres.trim().split(/\s+/)[0] ?? '';
}

export function saludoSegunHora(ahora = new Date()) {
  const hora = ahora.getHours();
  if (hora < 12) {
    return 'Buenos días';
  }
  return hora < 19 ? 'Buenas tardes' : 'Buenas noches';
}

/** Texto y estilo del chip de estado de una meta. */
export function describirEstado(estado) {
  switch (estado) {
    case 'COMPLETADA':
      return { texto: 'Completada', clase: 'status-chip--active' };
    case 'PAUSADA':
      return { texto: 'Pausada', clase: 'status-chip--warning' };
    case 'ATRASADA':
      return { texto: 'Atrasada', clase: 'status-chip--warning' };
    default:
      return { texto: 'En progreso', clase: 'status-chip--active' };
  }
}

/** Agrupa los estados de la API en las pestañas del filtro de la pantalla de metas. */
export function coincideConFiltro(meta, filtro) {
  switch (filtro) {
    case 'progreso':
      return meta.estado === 'EN_PROGRESO' || meta.estado === 'ATRASADA';
    case 'completadas':
      return meta.estado === 'COMPLETADA';
    case 'pausadas':
      return meta.estado === 'PAUSADA';
    default:
      return true;
  }
}
