import { describe, expect, it, vi } from 'vitest';
import { ErrorAplicacion } from '../../src/middlewares/errores.js';
import type { CategoriaLeccionFila, LeccionFila, RepositorioEducacion } from '../../src/modulos/educacion/educacion.repositorio.js';
import { crearServicioEducacion } from '../../src/modulos/educacion/educacion.servicio.js';

const categoria: CategoriaLeccionFila = { id_categoria_leccion: 3, nombre: 'Presupuesto', descripcion: null, icono: 'grafico', total_lecciones: 2 };
const leccion: LeccionFila = { id_leccion: 5, titulo: 'Presupuesto familiar', resumen: 'Resumen', duracion_minutos: 8, orden: 1, es_destacada: false };

function crearRepositorioFalso(sobrescribir: Partial<RepositorioEducacion> = {}): RepositorioEducacion {
  return {
    listarCategorias: vi.fn(async () => [categoria]),
    buscarCategoria: vi.fn(async (id: number) => (id === categoria.id_categoria_leccion ? categoria : null)),
    listarLecciones: vi.fn(async () => ({ filas: [leccion], total: 45 })),
    ...sobrescribir,
  };
}

describe('servicio de educación', () => {
  it('convierte las filas de las categorías al formato de la API', async () => {
    const servicio = crearServicioEducacion(crearRepositorioFalso());
    expect(await servicio.listarCategorias()).toEqual([
      { id: 3, nombre: 'Presupuesto', descripcion: null, icono: 'grafico', totalLecciones: 2 },
    ]);
  });

  it('calcula el desplazamiento y el total de páginas', async () => {
    const repositorio = crearRepositorioFalso();
    const servicio = crearServicioEducacion(repositorio);

    const pagina = await servicio.listarLecciones(3, 2, 20);

    expect(repositorio.listarLecciones).toHaveBeenCalledWith(3, 20, 20); // página 2 con 20 por página = saltar 20
    expect(pagina.paginacion).toEqual({ pagina: 2, limite: 20, total: 45, totalPaginas: 3 });
    expect(pagina.lecciones).toEqual([
      { id: 5, titulo: 'Presupuesto familiar', resumen: 'Resumen', duracionMinutos: 8, orden: 1, esDestacada: false },
    ]);
  });

  it('lanza 404 si la categoría no existe y no consulta las lecciones', async () => {
    const repositorio = crearRepositorioFalso();
    const servicio = crearServicioEducacion(repositorio);

    await expect(servicio.listarLecciones(999, 1, 20)).rejects.toMatchObject({
      estado: 404,
      codigo: 'CATEGORIA_NO_ENCONTRADA',
    });
    await expect(servicio.listarLecciones(999, 1, 20)).rejects.toBeInstanceOf(ErrorAplicacion);
    expect(repositorio.listarLecciones).not.toHaveBeenCalled();
  });

  it('informa cero páginas si la categoría no tiene lecciones', async () => {
    const servicio = crearServicioEducacion(
      crearRepositorioFalso({ listarLecciones: vi.fn(async () => ({ filas: [], total: 0 })) }),
    );
    const pagina = await servicio.listarLecciones(3, 1, 20);
    expect(pagina.lecciones).toEqual([]);
    expect(pagina.paginacion.totalPaginas).toBe(0);
  });
});
