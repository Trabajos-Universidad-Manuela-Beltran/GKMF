import { ErrorAplicacion } from '../middlewares/errores.js';

export interface OpcionesLimitador {
  /** Tareas que pueden ejecutarse a la vez. */
  maximo: number;
  /** Tareas que pueden esperar su turno; una más se rechaza con 503. */
  maximoEnCola: number;
}

export type Limitador = <T>(tarea: () => Promise<T>) => Promise<T>;

/**
 * Limita cuántas tareas costosas corren a la vez (por ejemplo, el hash scrypt, que usa 64 MiB y un hilo del
 * grupo de libuv por cada contraseña). Sin este tope, una ráfaga de registros o inicios de sesión agotaría la
 * memoria o dejaría sin hilos al resto de la API. Lo que excede la cola se rechaza con 503 en lugar de acumularse.
 */
export function crearLimitadorConcurrencia({ maximo, maximoEnCola }: OpcionesLimitador): Limitador {
  if (!Number.isInteger(maximo) || maximo < 1 || !Number.isInteger(maximoEnCola) || maximoEnCola < 0) {
    throw new RangeError('El limitador necesita un máximo de al menos 1 y una cola de 0 o más.');
  }

  let activas = 0;
  const enEspera: Array<() => void> = [];

  const liberar = (): void => {
    const siguiente = enEspera.shift();
    if (siguiente) {
      siguiente(); // el turno pasa directamente a la tarea en cola: `activas` no cambia
    } else {
      activas -= 1;
    }
  };

  return async (tarea) => {
    if (activas >= maximo) {
      if (enEspera.length >= maximoEnCola) {
        throw new ErrorAplicacion(503, 'SERVICIO_OCUPADO', 'El servicio está ocupado. Intente de nuevo en unos segundos.');
      }
      await new Promise<void>((resolver) => enEspera.push(resolver));
    } else {
      activas += 1;
    }
    try {
      return await tarea();
    } finally {
      liberar();
    }
  };
}
