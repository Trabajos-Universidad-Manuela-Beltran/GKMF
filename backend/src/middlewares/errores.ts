import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

/** Error esperado de la aplicación: su mensaje es seguro de mostrar al cliente. */
export class ErrorAplicacion extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalles?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorAplicacion';
  }
}

interface ErrorTraducido {
  estado: number;
  codigo: string;
  mensaje: string;
  detalles?: unknown;
}

/** Errores que lanzan express.json / body-parser, identificados por su propiedad `type`. */
interface ErrorDeCuerpo {
  type: string;
}

function esErrorDeCuerpo(error: unknown): error is ErrorDeCuerpo {
  return typeof error === 'object' && error !== null && typeof (error as ErrorDeCuerpo).type === 'string';
}

/** Errores creados con http-errors (status 4xx); los usa body-parser para los fallos de lectura del cuerpo. */
function esErrorHttpDelCliente(error: unknown): error is { status: number } {
  const estado = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  return typeof estado === 'number' && Number.isInteger(estado) && estado >= 400 && estado < 500;
}

function traducir(error: unknown): ErrorTraducido {
  if (error instanceof ErrorAplicacion) {
    return { estado: error.estado, codigo: error.codigo, mensaje: error.message, detalles: error.detalles };
  }
  if (error instanceof ZodError) {
    return {
      estado: 400,
      codigo: 'DATOS_INVALIDOS',
      mensaje: 'Los datos enviados no son válidos.',
      // Solo se informa el campo y la regla incumplida; nunca el valor recibido ni el nombre de un campo desconocido
      // (Zod lo copia en su mensaje y un cliente descuidado podría pintarlo como HTML).
      detalles: error.issues.map((problema) => ({
        campo: problema.path.join('.'),
        mensaje: problema.code === 'unrecognized_keys' ? 'Campo no permitido.' : problema.message,
      })),
    };
  }
  if (esErrorDeCuerpo(error)) {
    if (error.type === 'entity.parse.failed') {
      return { estado: 400, codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo de la solicitud no es un JSON válido.' };
    }
    if (error.type === 'entity.too.large') {
      return { estado: 413, codigo: 'CUERPO_DEMASIADO_GRANDE', mensaje: 'El cuerpo de la solicitud supera el tamaño permitido.' };
    }
    if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
      return { estado: 415, codigo: 'CODIFICACION_NO_SOPORTADA', mensaje: 'La codificación de la solicitud no está soportada.' };
    }
  }
  // Otros errores HTTP del cliente que lanza body-parser (subida cortada, tamaño inválido...): son fallo del
  // cliente y no un error interno. Se responde un mensaje genérico, nunca el del error original.
  if (esErrorHttpDelCliente(error)) {
    return { estado: error.status, codigo: 'SOLICITUD_INVALIDA', mensaje: 'La solicitud no es válida.' };
  }
  // Cualquier otro error es un fallo interno: no se expone su mensaje ni su traza.
  return { estado: 500, codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error interno. Intente de nuevo más tarde.' };
}

/** Responde 404 a cualquier ruta no definida. */
export const manejadorNoEncontrado: RequestHandler = (_req, _res, next) => {
  next(new ErrorAplicacion(404, 'RUTA_NO_ENCONTRADA', 'El recurso solicitado no existe.'));
};

/** Manejador central: todas las respuestas de error usan el mismo formato. */
export function crearManejadorErrores(logger: Logger): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const traducido = traducir(error);
    const contexto = { idSolicitud: req.id, metodo: req.method, ruta: req.path, estado: traducido.estado };

    if (traducido.estado >= 500) {
      logger.error({ ...contexto, err: error }, 'Error no controlado');
    } else {
      logger.warn({ ...contexto, codigo: traducido.codigo }, 'Solicitud rechazada');
    }

    if (traducido.estado === 401) {
      res.setHeader('WWW-Authenticate', 'Bearer');
    }
    res.status(traducido.estado).json({
      exito: false,
      error: {
        codigo: traducido.codigo,
        mensaje: traducido.mensaje,
        ...(traducido.detalles === undefined ? {} : { detalles: traducido.detalles }),
        idSolicitud: req.id,
      },
    });
  };
}
