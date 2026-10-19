// Pruebas de las funciones puras de la interfaz. Se ejecutan con:  node --test src/js/
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  coincideConFiltro,
  describirEstado,
  formatearFechaCorta,
  formatearFechaHora,
  formatearPesos,
  formatearPesosCompacto,
  formatearVariacion,
  hoyLocal,
  iniciales,
  parsearMonto,
  primerNombre,
  saludoSegunHora,
} from './formato.js';

describe('formatearPesos', () => {
  it('usa punto de miles, sin decimales si el valor es entero', () => {
    assert.equal(formatearPesos(72000), '$72.000');
    assert.equal(formatearPesos(247500), '$247.500');
    assert.equal(formatearPesos(0), '$0');
    assert.equal(formatearPesos(1250000), '$1.250.000');
  });

  it('muestra decimales solo si existen', () => {
    assert.equal(formatearPesos(1500.5), '$1.500,50');
    assert.equal(formatearPesos(0.29), '$0,29');
  });

  it('usa el signo menos tipográfico en negativos', () => {
    assert.equal(formatearPesos(-5000), '−$5.000');
  });
});

describe('formatearVariacion y formatearPesosCompacto', () => {
  it('antepone el signo a las variaciones', () => {
    assert.equal(formatearVariacion(32000), '+$32.000');
    assert.equal(formatearVariacion(-1500), '−$1.500');
    assert.equal(formatearVariacion(0), '$0');
  });

  it('abrevia miles y millones', () => {
    assert.equal(formatearPesosCompacto(202000), '$202K');
    assert.equal(formatearPesosCompacto(1250000), '$1,3M');
    assert.equal(formatearPesosCompacto(950), '$950');
    assert.equal(formatearPesosCompacto(999999), '$1M');
    assert.equal(formatearPesosCompacto(999400), '$999K');
  });
});

describe('parsearMonto', () => {
  const casos = [
    ['50000', 50000],
    ['50.000', 50000],
    ['50,000', 50000],
    ['$ 1.234.567', 1234567],
    ['1.234.567,89', 1234567.89],
    ['1,234,567.89', 1234567.89],
    ['1,234.56', 1234.56],
    ['0,29', 0.29],
    ['50,5', 50.5],
    ['50.25', 50.25],
    ['  12000  ', 12000],
  ];
  for (const [entrada, esperado] of casos) {
    it(`lee "${entrada}" como ${esperado}`, () => assert.equal(parsearMonto(entrada), esperado));
  }

  const invalidos = ['', 'abc', '-500', '0', '0,00', '12,345,67', '1.2.3,4', '10.1234', '1e5', '5 000 a', '100000000001', '0.500', '0,500', '0,001', '00.500', null, undefined, 5000];
  for (const entrada of invalidos) {
    it(`rechaza ${JSON.stringify(entrada)}`, () => assert.equal(parsearMonto(entrada), null));
  }
});

describe('fechas', () => {
  it('formatea una fecha de calendario sin desfases de zona horaria', () => {
    assert.equal(formatearFechaCorta('2026-12-30'), '30 dic 2026');
    assert.equal(formatearFechaCorta('2026-01-01T00:00:00.000Z'), '1 ene 2026');
  });

  it('describe el instante como hoy, ayer o fecha', () => {
    const ahora = new Date(2026, 9, 18, 20, 30); // 18 oct 2026, hora local
    assert.equal(formatearFechaHora(new Date(2026, 9, 18, 10, 32).toISOString(), ahora), 'Hoy, 10:32 a. m.');
    assert.equal(formatearFechaHora(new Date(2026, 9, 17, 20, 15).toISOString(), ahora), 'Ayer, 8:15 p. m.');
    assert.equal(formatearFechaHora(new Date(2026, 9, 3, 0, 5).toISOString(), ahora), '3 oct, 12:05 a. m.');
  });

  it('devuelve el día local en formato AAAA-MM-DD', () => {
    assert.equal(hoyLocal(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  });
});

describe('nombres y saludos', () => {
  it('saca las iniciales ignorando espacios y acentos', () => {
    assert.equal(iniciales('Ana María', 'Pérez Gómez'), 'AP');
    assert.equal(iniciales('  ángel', 'ñoño'), 'ÁÑ');
  });

  it('toma el primer nombre', () => {
    assert.equal(primerNombre('Katherin Johana'), 'Katherin');
    assert.equal(primerNombre('  Ana  '), 'Ana');
  });

  it('saluda según la hora', () => {
    assert.equal(saludoSegunHora(new Date(2026, 0, 1, 8)), 'Buenos días');
    assert.equal(saludoSegunHora(new Date(2026, 0, 1, 15)), 'Buenas tardes');
    assert.equal(saludoSegunHora(new Date(2026, 0, 1, 21)), 'Buenas noches');
  });
});

describe('estados de las metas', () => {
  it('traduce el estado a texto y clase visual', () => {
    assert.deepEqual(describirEstado('COMPLETADA'), { texto: 'Completada', clase: 'status-chip--active' });
    assert.deepEqual(describirEstado('ATRASADA'), { texto: 'Atrasada', clase: 'status-chip--warning' });
    assert.equal(describirEstado('EN_PROGRESO').texto, 'En progreso');
  });

  it('agrupa los estados en los filtros (atrasada cuenta como en progreso)', () => {
    assert.equal(coincideConFiltro({ estado: 'ATRASADA' }, 'progreso'), true);
    assert.equal(coincideConFiltro({ estado: 'COMPLETADA' }, 'progreso'), false);
    assert.equal(coincideConFiltro({ estado: 'PAUSADA' }, 'pausadas'), true);
    assert.equal(coincideConFiltro({ estado: 'PAUSADA' }, 'todas'), true);
  });
});
