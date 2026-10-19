import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ErrorAplicacion } from '../../src/middlewares/errores.js';
import type { MetaFila, MovimientoFila, RepositorioMetas } from '../../src/modulos/metas/metas.repositorio.js';
import { crearServicioMetas, MAXIMO_METAS_POR_USUARIO, type ServicioMetas } from '../../src/modulos/metas/metas.servicio.js';

// "Ahora" fijo: 2026-10-18 20:30 en Bogotá (UTC-5) = 2026-10-19 01:30 UTC. En UTC ya es "mañana", en Bogotá todavía es 18.
const AHORA = new Date('2026-10-19T01:30:00.000Z');

function meta(sobrescribir: Partial<MetaFila> = {}): MetaFila {
  return {
    id_meta: 1,
    codigo_global: '11111111-1111-4111-8111-111111111111',
    nombre: 'Mercado del mes',
    descripcion: 'Alimentación familiar',
    icono: 'mercado',
    monto_objetivo: 100_000,
    monto_ahorrado: 72_000,
    fecha_limite: new Date('2026-12-30T00:00:00.000Z'),
    estado: 'EN_PROGRESO',
    fecha_creacion: new Date('2026-10-01T15:00:00.000Z'),
    ...sobrescribir,
  };
}

function movimiento(sobrescribir: Partial<MovimientoFila> = {}): MovimientoFila {
  return {
    id_transaccion: 5,
    codigo_global: '22222222-2222-4222-8222-222222222222',
    tipo: 'DEPOSITO_META',
    monto: 20_000,
    descripcion: 'Abono',
    fecha_movimiento: new Date('2026-10-18T22:00:00.000Z'),
    id_meta: 1,
    nombre_meta: 'Mercado del mes',
    ...sobrescribir,
  };
}

function repositorioFalso(sobrescribir: Partial<RepositorioMetas> = {}): RepositorioMetas {
  return {
    contarMetas: vi.fn(async () => 0),
    crearMeta: vi.fn(async () => ({ meta: meta(), creada: true })),
    listarMetas: vi.fn(async () => [meta()]),
    buscarMeta: vi.fn(async () => meta()),
    registrarMovimiento: vi.fn(async () => ({ meta: meta({ monto_ahorrado: 92_000 }), movimiento: movimiento(), creado: true })),
    listarMovimientos: vi.fn(async () => ({ filas: [movimiento()], total: 1 })),
    netoDesde: vi.fn(async () => 32_000),
    ...sobrescribir,
  };
}

const crear = (repositorio: RepositorioMetas): ServicioMetas => crearServicioMetas({ repositorio, reloj: () => AHORA, generarCodigo: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });

async function esperarError(promesa: Promise<unknown>): Promise<ErrorAplicacion> {
  try {
    await promesa;
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorAplicacion);
    return error as ErrorAplicacion;
  }
  throw new Error('Se esperaba un ErrorAplicacion y la operación terminó bien');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServicioMetas.crearMeta', () => {
  const datos = { nombre: 'Mercado del mes', montoObjetivo: 100_000, fechaLimite: '2026-12-30' };

  it('crea la meta del usuario autenticado con un código global generado y devuelve el DTO', async () => {
    const repositorio = repositorioFalso();
    const { meta: creada, creada: esNueva } = await crear(repositorio).crearMeta(9, datos);

    expect(esNueva).toBe(true);
    expect(repositorio.crearMeta).toHaveBeenCalledWith(9, {
      nombre: 'Mercado del mes',
      descripcion: null,
      icono: null,
      montoObjetivo: 100_000,
      fechaLimite: '2026-12-30',
      codigoGlobal: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(creada).toEqual({
      id: 1,
      codigoGlobal: '11111111-1111-4111-8111-111111111111',
      nombre: 'Mercado del mes',
      descripcion: 'Alimentación familiar',
      icono: 'mercado',
      montoObjetivo: 100_000,
      montoAhorrado: 72_000,
      porcentaje: 72,
      fechaLimite: '2026-12-30',
      estado: 'EN_PROGRESO',
      fechaCreacion: '2026-10-01T15:00:00.000Z',
    });
  });

  it('respeta el código global que envía el cliente (reintentos idempotentes, modo sin conexión)', async () => {
    const repositorio = repositorioFalso();
    await crear(repositorio).crearMeta(9, { ...datos, codigoGlobal: '33333333-3333-4333-8333-333333333333' });
    expect(vi.mocked(repositorio.crearMeta).mock.calls[0]?.[1].codigoGlobal).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('informa que no es nueva cuando el repositorio reconoce un reintento', async () => {
    const repositorio = repositorioFalso({ crearMeta: vi.fn(async () => ({ meta: meta(), creada: false })) });
    expect((await crear(repositorio).crearMeta(9, datos)).creada).toBe(false);
  });

  it('acepta como fecha límite el día de hoy en Bogotá, aunque en UTC ya sea mañana', async () => {
    const repositorio = repositorioFalso();
    await expect(crear(repositorio).crearMeta(9, { ...datos, fechaLimite: '2026-10-18' })).resolves.toBeDefined();
  });

  it('rechaza una fecha límite anterior a hoy (hora de Bogotá)', async () => {
    const repositorio = repositorioFalso();
    const error = await esperarError(crear(repositorio).crearMeta(9, { ...datos, fechaLimite: '2026-10-17' }));
    expect(error.estado).toBe(400);
    expect(error.codigo).toBe('FECHA_LIMITE_INVALIDA');
    expect(repositorio.crearMeta).not.toHaveBeenCalled();
  });

  it('rechaza una fecha límite a más de 30 años', async () => {
    const error = await esperarError(crear(repositorioFalso()).crearMeta(9, { ...datos, fechaLimite: '2057-01-01' }));
    expect(error.codigo).toBe('FECHA_LIMITE_INVALIDA');
  });

  it('limita la cantidad de metas por usuario', async () => {
    const repositorio = repositorioFalso({ contarMetas: vi.fn(async () => MAXIMO_METAS_POR_USUARIO) });
    const error = await esperarError(crear(repositorio).crearMeta(9, datos));
    expect(error.estado).toBe(409);
    expect(error.codigo).toBe('LIMITE_DE_METAS');
    expect(repositorio.crearMeta).not.toHaveBeenCalled();
  });
});

describe('ServicioMetas.listarMetas', () => {
  const metas = [
    meta({ id_meta: 1, monto_ahorrado: 72_000, monto_objetivo: 100_000 }),
    meta({ id_meta: 2, nombre: 'Útiles', monto_ahorrado: 85_000, monto_objetivo: 200_000 }),
    meta({ id_meta: 3, nombre: 'Fondo', monto_ahorrado: 45_000, monto_objetivo: 250_000 }),
    meta({ id_meta: 4, nombre: 'Bicicleta', monto_ahorrado: 300_000, monto_objetivo: 300_000, estado: 'COMPLETADA' }),
  ];

  it('calcula el resumen: total ahorrado, metas por estado, promedio de las activas y neto del mes', async () => {
    const repositorio = repositorioFalso({ listarMetas: vi.fn(async () => metas) });
    const { resumen } = await crear(repositorio).listarMetas(9);
    // promedio de las activas: (72 + 42 + 18) / 3 = 44
    expect(resumen).toEqual({ totalAhorrado: 502_000, metasActivas: 3, metasCompletadas: 1, metasPausadas: 0, promedioProgreso: 44, netoEsteMes: 32_000 });
  });

  it('calcula el inicio del mes en Bogotá (UTC-5) para el neto del mes', async () => {
    const repositorio = repositorioFalso({ listarMetas: vi.fn(async () => metas) });
    await crear(repositorio).listarMetas(9);
    // 1 de octubre de 2026, 00:00 en Bogotá = 05:00 UTC
    expect(repositorio.netoDesde).toHaveBeenCalledWith(9, new Date('2026-10-01T05:00:00.000Z'));
  });

  it('filtra por estado sin alterar el resumen', async () => {
    const repositorio = repositorioFalso({ listarMetas: vi.fn(async () => metas) });
    const { metas: filtradas, resumen } = await crear(repositorio).listarMetas(9, 'COMPLETADA');
    expect(filtradas.map((m) => m.id)).toEqual([4]);
    expect(resumen.metasActivas).toBe(3);
  });

  it('con el usuario sin metas devuelve ceros (sin dividir entre cero)', async () => {
    const repositorio = repositorioFalso({ listarMetas: vi.fn(async () => []), netoDesde: vi.fn(async () => 0) });
    const { metas: lista, resumen } = await crear(repositorio).listarMetas(9);
    expect(lista).toEqual([]);
    expect(resumen).toEqual({ totalAhorrado: 0, metasActivas: 0, metasCompletadas: 0, metasPausadas: 0, promedioProgreso: 0, netoEsteMes: 0 });
  });

  it('suma el dinero en centavos: 100,10 + 200,20 es exactamente 300,30 y no 300,29999…', async () => {
    const repositorio = repositorioFalso({
      listarMetas: vi.fn(async () => [meta({ id_meta: 1, monto_ahorrado: 100.1, monto_objetivo: 500 }), meta({ id_meta: 2, monto_ahorrado: 200.2, monto_objetivo: 500 })]),
    });
    expect((await crear(repositorio).listarMetas(9)).resumen.totalAhorrado).toBe(300.3);
  });

  it('con objetivos enormes el porcentaje sigue siendo exacto (99.999.999.999,99 de 100.000.000.000 es 99 %)', async () => {
    const repositorio = repositorioFalso({ listarMetas: vi.fn(async () => [meta({ monto_ahorrado: 99_999_999_999.99, monto_objetivo: 100_000_000_000 })]) });
    expect((await crear(repositorio).listarMetas(9)).metas[0]?.porcentaje).toBe(99);
  });

  it('una meta en progreso con la fecha límite vencida (hoy en Bogotá) se muestra ATRASADA; una completada o con fecha de hoy, no', async () => {
    const repositorio = repositorioFalso({
      listarMetas: vi.fn(async () => [
        meta({ id_meta: 1, fecha_limite: new Date('2026-10-17T00:00:00.000Z') }),
        meta({ id_meta: 2, fecha_limite: new Date('2026-10-17T00:00:00.000Z'), estado: 'COMPLETADA', monto_ahorrado: 100_000 }),
        meta({ id_meta: 3, fecha_limite: new Date('2026-10-18T00:00:00.000Z') }),
      ]),
    });
    const { metas: lista, resumen } = await crear(repositorio).listarMetas(9);
    expect(lista.map((m) => m.estado)).toEqual(['ATRASADA', 'COMPLETADA', 'EN_PROGRESO']);
    expect(resumen.metasActivas).toBe(2); // atrasada y en progreso siguen contando como activas
  });

  it('el porcentaje nunca supera 100 y no redondea hacia arriba una meta incompleta', async () => {
    const repositorio = repositorioFalso({
      listarMetas: vi.fn(async () => [meta({ id_meta: 1, monto_ahorrado: 99_999, monto_objetivo: 100_000 }), meta({ id_meta: 2, monto_ahorrado: 120_000, monto_objetivo: 100_000, estado: 'COMPLETADA' })]),
    });
    const { metas: lista } = await crear(repositorio).listarMetas(9);
    expect(lista.map((m) => m.porcentaje)).toEqual([99, 100]);
  });
});

describe('ServicioMetas.obtenerMeta', () => {
  it('devuelve la meta del usuario', async () => {
    const repositorio = repositorioFalso();
    expect((await crear(repositorio).obtenerMeta(9, 1)).id).toBe(1);
    expect(repositorio.buscarMeta).toHaveBeenCalledWith(9, 1);
  });

  it('responde 404 si no existe o es de otro usuario (no se distingue, para no revelar que existe)', async () => {
    const repositorio = repositorioFalso({ buscarMeta: vi.fn(async () => null) });
    const error = await esperarError(crear(repositorio).obtenerMeta(9, 1));
    expect(error.estado).toBe(404);
    expect(error.codigo).toBe('META_NO_ENCONTRADA');
  });
});

describe('ServicioMetas.depositar y retirar', () => {
  it('deposita con el usuario autenticado, genera el código global y devuelve meta y movimiento', async () => {
    const repositorio = repositorioFalso();
    const resultado = await crear(repositorio).depositar(9, 1, { monto: 20_000 });

    expect(repositorio.registrarMovimiento).toHaveBeenCalledWith({
      idUsuario: 9,
      idMeta: 1,
      tipo: 'DEPOSITO_META',
      monto: 20_000,
      descripcion: 'Depósito a meta de ahorro',
      codigoGlobal: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(resultado.creado).toBe(true);
    expect(resultado.meta.montoAhorrado).toBe(92_000);
    expect(resultado.movimiento).toEqual({
      id: 5,
      codigoGlobal: '22222222-2222-4222-8222-222222222222',
      tipo: 'DEPOSITO_META',
      monto: 20_000,
      descripcion: 'Abono',
      fecha: '2026-10-18T22:00:00.000Z',
      idMeta: 1,
      nombreMeta: 'Mercado del mes',
    });
  });

  it('retira usando el tipo RETIRO_META y la descripción indicada', async () => {
    const repositorio = repositorioFalso();
    await crear(repositorio).retirar(9, 1, { monto: 5_000, descripcion: 'Para el bus', codigoGlobal: '44444444-4444-4444-8444-444444444444' });
    expect(repositorio.registrarMovimiento).toHaveBeenCalledWith({
      idUsuario: 9,
      idMeta: 1,
      tipo: 'RETIRO_META',
      monto: 5_000,
      descripcion: 'Para el bus',
      codigoGlobal: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('deja pasar los errores de negocio del repositorio (saldo insuficiente, meta completada...)', async () => {
    const repositorio = repositorioFalso({
      registrarMovimiento: vi.fn(async () => {
        throw new ErrorAplicacion(409, 'SALDO_INSUFICIENTE', 'La meta no tiene saldo suficiente.');
      }),
    });
    const error = await esperarError(crear(repositorio).retirar(9, 1, { monto: 999_999 }));
    expect(error.codigo).toBe('SALDO_INSUFICIENTE');
  });
});

describe('ServicioMetas.listarMovimientos', () => {
  it('pagina y convierte las filas', async () => {
    const repositorio = repositorioFalso({ listarMovimientos: vi.fn(async () => ({ filas: [movimiento()], total: 41 })) });
    const { movimientos, paginacion } = await crear(repositorio).listarMovimientos(9, { pagina: 3, limite: 20 });
    expect(repositorio.listarMovimientos).toHaveBeenCalledWith(9, undefined, 40, 20);
    expect(movimientos).toHaveLength(1);
    expect(paginacion).toEqual({ pagina: 3, limite: 20, total: 41, totalPaginas: 3 });
  });

  it('filtra por meta', async () => {
    const repositorio = repositorioFalso();
    await crear(repositorio).listarMovimientos(9, { pagina: 1, limite: 10, idMeta: 4 });
    expect(repositorio.listarMovimientos).toHaveBeenCalledWith(9, 4, 0, 10);
  });
});
