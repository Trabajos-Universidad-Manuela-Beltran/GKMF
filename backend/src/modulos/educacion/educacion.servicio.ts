import { ErrorAplicacion } from '../../middlewares/errores.js';
import type { RepositorioEducacion } from './educacion.repositorio.js';

export interface CategoriaLeccionDto {
  id: number;
  nombre: string;
  descripcion: string | null;
  icono: string | null;
  totalLecciones: number;
}

export interface LeccionDto {
  id: number;
  titulo: string;
  resumen: string;
  duracionMinutos: number;
  orden: number;
  esDestacada: boolean;
}

export interface PaginaLecciones {
  lecciones: LeccionDto[];
  paginacion: { pagina: number; limite: number; total: number; totalPaginas: number };
}

export interface ServicioEducacion {
  listarCategorias(): Promise<CategoriaLeccionDto[]>;
  listarLecciones(idCategoria: number, pagina: number, limite: number): Promise<PaginaLecciones>;
}

/** Lógica de negocio del módulo de educación financiera (pantalla "Aprende" del prototipo). */
export function crearServicioEducacion(repositorio: RepositorioEducacion): ServicioEducacion {
  return {
    async listarCategorias() {
      const filas = await repositorio.listarCategorias();
      return filas.map((fila) => ({
        id: fila.id_categoria_leccion,
        nombre: fila.nombre,
        descripcion: fila.descripcion,
        icono: fila.icono,
        totalLecciones: fila.total_lecciones,
      }));
    },

    async listarLecciones(idCategoria, pagina, limite) {
      const categoria = await repositorio.buscarCategoria(idCategoria);
      if (!categoria) {
        throw new ErrorAplicacion(404, 'CATEGORIA_NO_ENCONTRADA', 'La categoría solicitada no existe.');
      }
      const { filas, total } = await repositorio.listarLecciones(idCategoria, (pagina - 1) * limite, limite);
      return {
        lecciones: filas.map((fila) => ({
          id: fila.id_leccion,
          titulo: fila.titulo,
          resumen: fila.resumen,
          duracionMinutos: fila.duracion_minutos,
          orden: fila.orden,
          esDestacada: Boolean(fila.es_destacada),
        })),
        paginacion: { pagina, limite, total, totalPaginas: Math.ceil(total / limite) },
      };
    },
  };
}
