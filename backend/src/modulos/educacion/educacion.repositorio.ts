import sql from 'mssql';
import type { Conexion } from '../../db/conexion.js';

export interface CategoriaLeccionFila {
  id_categoria_leccion: number;
  nombre: string;
  descripcion: string | null;
  icono: string | null;
  total_lecciones: number;
}

export interface LeccionFila {
  id_leccion: number;
  titulo: string;
  resumen: string;
  duracion_minutos: number;
  orden: number;
  es_destacada: boolean;
}

export interface RepositorioEducacion {
  listarCategorias(): Promise<CategoriaLeccionFila[]>;
  buscarCategoria(idCategoria: number): Promise<CategoriaLeccionFila | null>;
  listarLecciones(idCategoria: number, desplazamiento: number, limite: number): Promise<{ filas: LeccionFila[]; total: number }>;
}

// Solo se piden las columnas necesarias (nunca SELECT *) y todo valor variable viaja como
// parámetro tipado: la consulta es texto fijo, por lo que no admite inyección SQL.
const COLUMNAS_CATEGORIA = `
  c.id_categoria_leccion, c.nombre, c.descripcion, c.icono,
  (SELECT COUNT(*) FROM dbo.leccion AS l WHERE l.id_categoria_leccion = c.id_categoria_leccion AND l.activa = 1) AS total_lecciones`;

const SQL_CATEGORIAS = `SELECT ${COLUMNAS_CATEGORIA} FROM dbo.categoria_leccion AS c ORDER BY c.nombre;`;

const SQL_CATEGORIA = `SELECT ${COLUMNAS_CATEGORIA} FROM dbo.categoria_leccion AS c WHERE c.id_categoria_leccion = @idCategoria;`;

const SQL_LECCIONES = `
  SELECT id_leccion, titulo, resumen, duracion_minutos, orden, es_destacada
    FROM dbo.leccion
   WHERE id_categoria_leccion = @idCategoria AND activa = 1
   ORDER BY orden, id_leccion
  OFFSET @desplazamiento ROWS FETCH NEXT @limite ROWS ONLY;

  SELECT COUNT(*) AS total
    FROM dbo.leccion
   WHERE id_categoria_leccion = @idCategoria AND activa = 1;`;

export function crearRepositorioEducacion(conexion: Conexion): RepositorioEducacion {
  return {
    async listarCategorias() {
      const resultado = await (await conexion.pool()).request().query<CategoriaLeccionFila>(SQL_CATEGORIAS);
      return resultado.recordset;
    },

    async buscarCategoria(idCategoria) {
      const resultado = await (await conexion.pool())
        .request()
        .input('idCategoria', sql.Int, idCategoria)
        .query<CategoriaLeccionFila>(SQL_CATEGORIA);
      return resultado.recordset[0] ?? null;
    },

    async listarLecciones(idCategoria, desplazamiento, limite) {
      // Dos consultas en un mismo envío: @types/mssql tipa `recordsets` como tupla, sin necesidad de casts.
      const resultado = await (await conexion.pool())
        .request()
        .input('idCategoria', sql.Int, idCategoria)
        .input('desplazamiento', sql.Int, desplazamiento)
        .input('limite', sql.Int, limite)
        .query<[LeccionFila, { total: number }]>(SQL_LECCIONES);
      const [filas, totales] = resultado.recordsets;
      return { filas, total: totales[0]?.total ?? 0 };
    },
  };
}
