import { randomUUID } from 'node:crypto';
import { ErrorAplicacion } from '../../middlewares/errores.js';
import type { EstadoMeta, MetaFila, MovimientoFila, RepositorioMetas, TipoMovimientoMeta } from './metas.repositorio.js';

export interface MetaDto {
  id: number;
  codigoGlobal: string;
  nombre: string;
  descripcion: string | null;
  icono: string | null;
  montoObjetivo: number;
  montoAhorrado: number;
  /** Avance entero de 0 a 100; solo llega a 100 cuando la meta está realmente completa. */
  porcentaje: number;
  fechaLimite: string;
  estado: EstadoMeta;
  fechaCreacion: string;
}

export interface MovimientoDto {
  id: number;
  codigoGlobal: string;
  tipo: string;
  monto: number;
  descripcion: string;
  fecha: string;
  idMeta: number | null;
  nombreMeta: string | null;
}

export interface ResumenMetas {
  totalAhorrado: number;
  metasActivas: number;
  metasCompletadas: number;
  metasPausadas: number;
  /** Promedio del avance de las metas activas (0 si no hay ninguna). */
  promedioProgreso: number;
  /** Depósitos menos retiros del mes en curso (hora de Bogotá). */
  netoEsteMes: number;
}

export interface DatosCrearMeta {
  nombre: string;
  descripcion?: string | null;
  icono?: string | null;
  montoObjetivo: number;
  fechaLimite: string;
  codigoGlobal?: string;
}

export interface DatosOperacion {
  monto: number;
  descripcion?: string;
  codigoGlobal?: string;
}

export interface ConsultaMovimientos {
  pagina: number;
  limite: number;
  idMeta?: number;
}

export interface ResultadoMovimiento {
  meta: MetaDto;
  movimiento: MovimientoDto;
  /** false cuando la solicitud repetía un código global ya procesado (no se asentó de nuevo). */
  creado: boolean;
}

export interface ServicioMetas {
  crearMeta(idUsuario: number, datos: DatosCrearMeta): Promise<{ meta: MetaDto; creada: boolean }>;
  listarMetas(idUsuario: number, estado?: EstadoMeta): Promise<{ metas: MetaDto[]; resumen: ResumenMetas }>;
  obtenerMeta(idUsuario: number, idMeta: number): Promise<MetaDto>;
  depositar(idUsuario: number, idMeta: number, datos: DatosOperacion): Promise<ResultadoMovimiento>;
  retirar(idUsuario: number, idMeta: number, datos: DatosOperacion): Promise<ResultadoMovimiento>;
  listarMovimientos(idUsuario: number, consulta: ConsultaMovimientos): Promise<{ movimientos: MovimientoDto[]; paginacion: { pagina: number; limite: number; total: number; totalPaginas: number } }>;
}

export interface DependenciasServicioMetas {
  repositorio: RepositorioMetas;
  /** Reloj inyectable para probar las reglas que dependen de la fecha. */
  reloj?: () => Date;
  generarCodigo?: () => string;
}

export const MAXIMO_METAS_POR_USUARIO = 100;
const ANIOS_MAXIMOS_FECHA_LIMITE = 30;
/** Colombia no tiene horario de verano: Bogotá siempre es UTC-5. */
const DESFASE_BOGOTA_HORAS = 5;

/** Fecha de hoy en Bogotá como AAAA-MM-DD. */
function hoyEnBogota(ahora: Date): string {
  const bogota = new Date(ahora.getTime() - DESFASE_BOGOTA_HORAS * 3_600_000);
  return bogota.toISOString().slice(0, 10);
}

/** Instante UTC en que empieza el mes en curso en Bogotá (00:00 locales = 05:00 UTC). */
function inicioDeMesEnBogota(ahora: Date): Date {
  const [anio, mes] = hoyEnBogota(ahora).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(anio, mes - 1, 1, DESFASE_BOGOTA_HORAS));
}

function sumarAnios(fecha: string, anios: number): string {
  const [anio, resto] = [Number(fecha.slice(0, 4)), fecha.slice(4)];
  return `${String(anio + anios).padStart(4, '0')}${resto}`;
}

/** El dinero se compara y suma en centavos enteros: con decimales de coma flotante 100,10 + 200,20 da 300,29999… */
const aCentavos = (pesos: number): number => Math.round(pesos * 100);

/** Entero de 0 a 100, calculado con centavos enteros (división exacta) y sin redondear hacia arriba una meta incompleta. */
function calcularPorcentaje(ahorrado: number, objetivo: number): number {
  const objetivoCentavos = aCentavos(objetivo);
  if (objetivoCentavos <= 0) {
    return 0;
  }
  return Math.min(100, Math.floor((aCentavos(ahorrado) * 100) / objetivoCentavos));
}

/**
 * ATRASADA no se guarda: se deriva. Una meta en progreso cuya fecha límite ya pasó (hoy en Bogotá) se muestra atrasada; así el
 * estado nunca queda obsoleto aunque nadie lo recalcule en la base de datos.
 */
const aMetaDto = (fila: MetaFila, hoy: string): MetaDto => ({
  id: fila.id_meta,
  codigoGlobal: fila.codigo_global.toLowerCase(),
  nombre: fila.nombre,
  descripcion: fila.descripcion,
  icono: fila.icono,
  montoObjetivo: Number(fila.monto_objetivo),
  montoAhorrado: Number(fila.monto_ahorrado),
  porcentaje: calcularPorcentaje(Number(fila.monto_ahorrado), Number(fila.monto_objetivo)),
  fechaLimite: fila.fecha_limite.toISOString().slice(0, 10),
  estado: fila.estado === 'EN_PROGRESO' && fila.fecha_limite.toISOString().slice(0, 10) < hoy ? 'ATRASADA' : fila.estado,
  fechaCreacion: fila.fecha_creacion.toISOString(),
});

const aMovimientoDto = (fila: MovimientoFila): MovimientoDto => ({
  id: Number(fila.id_transaccion),
  codigoGlobal: fila.codigo_global.toLowerCase(),
  tipo: fila.tipo,
  monto: Number(fila.monto),
  descripcion: fila.descripcion,
  fecha: fila.fecha_movimiento.toISOString(),
  idMeta: fila.id_meta,
  nombreMeta: fila.nombre_meta,
});

const DESCRIPCION_POR_DEFECTO: Record<TipoMovimientoMeta, string> = {
  DEPOSITO_META: 'Depósito a meta de ahorro',
  RETIRO_META: 'Retiro de meta de ahorro',
};

/**
 * Casos de uso de metas de ahorro y sus movimientos: CU-05 (crear), CU-06 (consultar), CU-09 (depositar),
 * CU-10 (retirar, con CU-20 validar saldo), CU-11 (historial) y CU-19 (asentar la transacción).
 */
export function crearServicioMetas(dependencias: DependenciasServicioMetas): ServicioMetas {
  const { repositorio } = dependencias;
  const reloj = dependencias.reloj ?? (() => new Date());
  const generarCodigo = dependencias.generarCodigo ?? randomUUID;
  const aDto = (fila: MetaFila): MetaDto => aMetaDto(fila, hoyEnBogota(reloj()));

  async function operar(idUsuario: number, idMeta: number, tipo: TipoMovimientoMeta, datos: DatosOperacion): Promise<ResultadoMovimiento> {
    const resultado = await repositorio.registrarMovimiento({
      idUsuario,
      idMeta,
      tipo,
      monto: datos.monto,
      descripcion: datos.descripcion ?? DESCRIPCION_POR_DEFECTO[tipo],
      codigoGlobal: datos.codigoGlobal ?? generarCodigo(),
    });
    return { meta: aDto(resultado.meta), movimiento: aMovimientoDto(resultado.movimiento), creado: resultado.creado };
  }

  return {
    async crearMeta(idUsuario, datos) {
      const hoy = hoyEnBogota(reloj());
      if (datos.fechaLimite < hoy || datos.fechaLimite > sumarAnios(hoy, ANIOS_MAXIMOS_FECHA_LIMITE)) {
        throw new ErrorAplicacion(400, 'FECHA_LIMITE_INVALIDA', `La fecha límite debe estar entre hoy y los próximos ${ANIOS_MAXIMOS_FECHA_LIMITE} años.`);
      }
      if ((await repositorio.contarMetas(idUsuario)) >= MAXIMO_METAS_POR_USUARIO) {
        throw new ErrorAplicacion(409, 'LIMITE_DE_METAS', `Se alcanzó el máximo de ${MAXIMO_METAS_POR_USUARIO} metas por usuario.`);
      }
      const { meta, creada } = await repositorio.crearMeta(idUsuario, {
        nombre: datos.nombre,
        descripcion: datos.descripcion ?? null,
        icono: datos.icono ?? null,
        montoObjetivo: datos.montoObjetivo,
        fechaLimite: datos.fechaLimite,
        codigoGlobal: datos.codigoGlobal ?? generarCodigo(),
      });
      return { meta: aDto(meta), creada };
    },

    async listarMetas(idUsuario, estado) {
      const [filas, neto] = await Promise.all([repositorio.listarMetas(idUsuario), repositorio.netoDesde(idUsuario, inicioDeMesEnBogota(reloj()))]);
      const todas = filas.map(aDto);
      const activas = todas.filter((meta) => meta.estado === 'EN_PROGRESO' || meta.estado === 'ATRASADA');
      const resumen: ResumenMetas = {
        totalAhorrado: todas.reduce((suma, meta) => suma + aCentavos(meta.montoAhorrado), 0) / 100,
        metasActivas: activas.length,
        metasCompletadas: todas.filter((meta) => meta.estado === 'COMPLETADA').length,
        metasPausadas: todas.filter((meta) => meta.estado === 'PAUSADA').length,
        promedioProgreso: activas.length === 0 ? 0 : Math.round(activas.reduce((suma, meta) => suma + meta.porcentaje, 0) / activas.length),
        netoEsteMes: neto,
      };
      return { metas: estado ? todas.filter((meta) => meta.estado === estado) : todas, resumen };
    },

    async obtenerMeta(idUsuario, idMeta) {
      const fila = await repositorio.buscarMeta(idUsuario, idMeta);
      if (!fila) {
        // Mismo 404 si no existe o es de otro usuario: no se revela que el identificador pertenece a alguien más.
        throw new ErrorAplicacion(404, 'META_NO_ENCONTRADA', 'La meta de ahorro no existe.');
      }
      return aDto(fila);
    },

    depositar: (idUsuario, idMeta, datos) => operar(idUsuario, idMeta, 'DEPOSITO_META', datos),
    retirar: (idUsuario, idMeta, datos) => operar(idUsuario, idMeta, 'RETIRO_META', datos),

    async listarMovimientos(idUsuario, consulta) {
      const { filas, total } = await repositorio.listarMovimientos(idUsuario, consulta.idMeta, (consulta.pagina - 1) * consulta.limite, consulta.limite);
      return {
        movimientos: filas.map(aMovimientoDto),
        paginacion: { pagina: consulta.pagina, limite: consulta.limite, total, totalPaginas: Math.ceil(total / consulta.limite) },
      };
    },
  };
}
