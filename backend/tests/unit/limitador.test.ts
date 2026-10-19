import { describe, expect, it } from 'vitest';
import { ErrorAplicacion } from '../../src/middlewares/errores.js';
import { crearLimitadorConcurrencia } from '../../src/seguridad/limitador.js';

/** Tarea que se queda esperando hasta que la prueba la libere; permite observar cuántas corren a la vez. */
function tareaControlable() {
  let liberar!: () => void;
  const terminada = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  return { terminada, liberar };
}

const turno = () => new Promise<void>((resolver) => setImmediate(resolver));

describe('limitador de concurrencia', () => {
  it('ejecuta como máximo N tareas a la vez y pone en cola el resto', async () => {
    const limitar = crearLimitadorConcurrencia({ maximo: 2, maximoEnCola: 10 });
    let activas = 0;
    let picoActivas = 0;
    const controles = Array.from({ length: 5 }, tareaControlable);

    const resultados = controles.map((control, indice) =>
      limitar(async () => {
        activas += 1;
        picoActivas = Math.max(picoActivas, activas);
        await control.terminada;
        activas -= 1;
        return indice;
      }),
    );

    await turno();
    expect(activas).toBe(2);

    for (const control of controles) {
      control.liberar();
      await turno();
    }
    expect(await Promise.all(resultados)).toEqual([0, 1, 2, 3, 4]);
    expect(picoActivas).toBe(2);
    expect(activas).toBe(0);
  });

  it('rechaza con 503 cuando la cola está llena, sin ejecutar la tarea', async () => {
    const limitar = crearLimitadorConcurrencia({ maximo: 1, maximoEnCola: 1 });
    const bloqueo = tareaControlable();
    const primera = limitar(() => bloqueo.terminada);
    const segunda = limitar(async () => 'en cola');
    let seEjecuto = false;

    await turno();
    const tercera = limitar(async () => {
      seEjecuto = true;
    });

    await expect(tercera).rejects.toMatchObject({ estado: 503, codigo: 'SERVICIO_OCUPADO' });
    await expect(tercera).rejects.toBeInstanceOf(ErrorAplicacion);
    expect(seEjecuto).toBe(false);

    bloqueo.liberar();
    await primera;
    expect(await segunda).toBe('en cola');
  });

  it('libera el turno cuando la tarea falla, para que la siguiente continúe', async () => {
    const limitar = crearLimitadorConcurrencia({ maximo: 1, maximoEnCola: 5 });
    const fallida = limitar(async () => {
      throw new Error('falló');
    });
    const siguiente = limitar(async () => 'continúa');

    await expect(fallida).rejects.toThrow('falló');
    expect(await siguiente).toBe('continúa');
  });

  it('rechaza una configuración inválida', () => {
    expect(() => crearLimitadorConcurrencia({ maximo: 0, maximoEnCola: 1 })).toThrow(RangeError);
    expect(() => crearLimitadorConcurrencia({ maximo: 1, maximoEnCola: -1 })).toThrow(RangeError);
  });
});
