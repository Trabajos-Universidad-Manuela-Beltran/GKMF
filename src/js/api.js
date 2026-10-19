// Cliente de la API de GKMF. Sin dependencias; usa fetch.
//
// Seguridad:
//  - Los tokens viven SOLO en memoria (variables de este módulo): no se escriben en localStorage ni en cookies, así
//    que no sobreviven a una recarga (hay que volver a iniciar sesión) pero tampoco quedan al alcance de otros scripts.
//  - Cada solicitud autenticada lleva "Authorization: Bearer". Si el token de acceso venció, se renueva UNA vez con el
//    token de refresco (que el servidor rota) y se reintenta la solicitud original.
//  - Todo error de red o de la API se convierte en ErrorApi con un mensaje seguro de mostrar.

export class ErrorApi extends Error {
  constructor(estado, codigo, mensaje, detalles) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles ?? [];
  }

  /** Texto seguro de mostrar a la persona (el mismo `message` de Error, con el nombre en español que usa el resto del código). */
  get mensaje() {
    return this.message;
  }
}

const TIEMPO_MAXIMO_MS = 15_000;
const CODIGOS_DE_TOKEN_VENCIDO = new Set(['TOKEN_INVALIDO', 'NO_AUTENTICADO']);

/** Convierte una respuesta con error (formato { exito:false, error:{...} }) en ErrorApi. */
async function aErrorApi(respuesta) {
  try {
    const cuerpo = await respuesta.json();
    const { codigo, mensaje, detalles } = cuerpo.error ?? {};
    return new ErrorApi(respuesta.status, codigo ?? 'ERROR', mensaje ?? 'Ocurrió un error inesperado.', detalles);
  } catch {
    return new ErrorApi(respuesta.status, 'ERROR', 'Ocurrió un error inesperado.');
  }
}

/**
 * @param {{ base: string, fetchImpl?: typeof fetch, alSesionExpirada?: () => void }} opciones
 */
export function crearClienteApi({ base, fetchImpl = (...args) => fetch(...args), alSesionExpirada = () => {} }) {
  const urlBase = base.replace(/\/+$/, '');
  let tokenAcceso = null;
  let tokenRefresco = null;
  let renovacionEnCurso = null;
  let generacion = 0; // sube al cerrar sesión: invalida cualquier renovación que siga en vuelo

  const guardarTokens = (datos) => {
    tokenAcceso = datos.tokenAcceso;
    tokenRefresco = datos.tokenRefresco;
  };
  const olvidarTokens = () => {
    tokenAcceso = null;
    tokenRefresco = null;
  };

  async function enviar(metodo, ruta, { cuerpo, autenticada }) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
    try {
      const cabeceras = { Accept: 'application/json' };
      if (cuerpo !== undefined) {
        cabeceras['Content-Type'] = 'application/json';
      }
      if (autenticada && tokenAcceso) {
        cabeceras.Authorization = `Bearer ${tokenAcceso}`;
      }
      return await fetchImpl(`${urlBase}${ruta}`, {
        method: metodo,
        headers: cabeceras,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        credentials: 'omit',
        cache: 'no-store',
        signal: control.signal,
      });
    } catch (error) {
      const agotado = error instanceof DOMException && error.name === 'AbortError';
      throw new ErrorApi(0, 'SIN_CONEXION', agotado ? 'El servidor tardó demasiado en responder. Inténtalo de nuevo.' : 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
    } finally {
      clearTimeout(temporizador);
    }
  }

  /**
   * Renueva la sesión; varias solicitudes que fallan a la vez comparten UNA sola renovación (el token se rota).
   *  - Si la persona cierra sesión mientras la renovación está en curso, el resultado se descarta (cambia `generacion`).
   *  - Solo un rechazo real del servidor (400, 401, 403) invalida la sesión local; un corte de red, un 429 o un 5xx son
   *    pasajeros y se dejan reintentar sin cerrar la sesión.
   */
  function renovar() {
    renovacionEnCurso ??= (async () => {
      const miGeneracion = generacion;
      try {
        if (!tokenRefresco) {
          throw new ErrorApi(401, 'TOKEN_REFRESCO_INVALIDO', 'La sesión expiró.');
        }
        const respuesta = await enviar('POST', '/api/v1/auth/refresco', { cuerpo: { tokenRefresco }, autenticada: false });
        if (!respuesta.ok) {
          throw await aErrorApi(respuesta);
        }
        const datos = (await respuesta.json()).datos;
        if (miGeneracion === generacion) {
          guardarTokens(datos);
        }
      } catch (error) {
        const rechazo = error instanceof ErrorApi && [400, 401, 403].includes(error.estado);
        if (rechazo && miGeneracion === generacion) {
          olvidarTokens();
          alSesionExpirada();
        }
        throw error;
      } finally {
        renovacionEnCurso = null;
      }
    })();
    return renovacionEnCurso;
  }

  async function solicitar(metodo, ruta, { cuerpo, autenticada = true } = {}) {
    let respuesta = await enviar(metodo, ruta, { cuerpo, autenticada });
    if (autenticada && respuesta.status === 401) {
      const error = await aErrorApi(respuesta.clone());
      if (CODIGOS_DE_TOKEN_VENCIDO.has(error.codigo) && tokenRefresco) {
        await renovar();
        respuesta = await enviar(metodo, ruta, { cuerpo, autenticada });
      }
    }
    if (!respuesta.ok) {
      throw await aErrorApi(respuesta);
    }
    return respuesta.status === 204 ? null : respuesta.json();
  }

  const consulta = (parametros) => {
    const texto = new URLSearchParams(Object.entries(parametros).filter(([, valor]) => valor !== undefined)).toString();
    return texto ? `?${texto}` : '';
  };

  return {
    tieneSesion: () => tokenAcceso !== null,

    async registrar(datos) {
      return (await solicitar('POST', '/api/v1/auth/registro', { cuerpo: datos, autenticada: false })).datos;
    },

    async iniciarSesion(correo, contrasena) {
      const { datos } = await solicitar('POST', '/api/v1/auth/login', { cuerpo: { correo, contrasena }, autenticada: false });
      guardarTokens(datos);
      return datos.usuario;
    },

    async cerrarSesion() {
      const refresco = tokenRefresco;
      generacion += 1;
      olvidarTokens();
      if (refresco) {
        // Si el servidor no responde, la sesión local ya se cerró; el token de refresco vence por sí solo.
        await solicitar('POST', '/api/v1/auth/cierre', { cuerpo: { tokenRefresco: refresco }, autenticada: false }).catch(() => {});
      }
    },

    listarMetas: () => solicitar('GET', '/api/v1/metas'),
    crearMeta: (datos) => solicitar('POST', '/api/v1/metas', { cuerpo: datos }),
    depositar: (idMeta, datos) => solicitar('POST', `/api/v1/metas/${idMeta}/depositos`, { cuerpo: datos }),
    retirar: (idMeta, datos) => solicitar('POST', `/api/v1/metas/${idMeta}/retiros`, { cuerpo: datos }),
    listarMovimientos: ({ pagina, limite, idMeta } = {}) => solicitar('GET', `/api/v1/movimientos${consulta({ pagina, limite, idMeta })}`),
    listarCategorias: () => solicitar('GET', '/api/v1/educacion/categorias'),
    listarLecciones: (idCategoria) => solicitar('GET', `/api/v1/educacion/categorias/${idCategoria}/lecciones`),
  };
}
