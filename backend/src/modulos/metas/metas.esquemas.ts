import { z } from 'zod';

// Enteros positivos en texto plano (parámetros de la URL): evita que Number() acepte "1e3", "0x10" o " 5".
const MAXIMO_INT_SQL = 2_147_483_647; // un identificador mayor no cabe en INT de SQL Server

const enteroPositivo = z
  .string()
  .regex(/^[1-9]\d{0,9}$/, 'debe ser un entero positivo')
  .transform(Number)
  .pipe(z.number().max(MAXIMO_INT_SQL, 'es demasiado grande'));

/** Máximo por operación y por meta: 100 mil millones de pesos, muy por debajo del tope de DECIMAL(14,2). */
export const MONTO_MAXIMO = 100_000_000_000;

// Caracteres de control (saltos de línea, tabulaciones, NUL...) no tienen sentido en un nombre ni en una descripción.
// eslint-disable-next-line no-control-regex
const CARACTERES_DE_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const textoLibre = (maximo: number) =>
  z
    .string({ error: 'debe ser un texto' })
    .trim()
    .min(1, 'no puede estar vacío')
    .max(maximo, `no puede superar ${maximo} caracteres`)
    .refine((texto) => !CARACTERES_DE_CONTROL.test(texto), 'contiene caracteres no permitidos');

/** Pesos con a lo sumo 2 decimales. Se compara en centavos con tolerancia para no rechazar 0,29 por el error de coma flotante. */
const monto = z
  .number({ error: 'debe ser un número' })
  .min(0.01, 'debe ser al menos 0,01')
  .max(MONTO_MAXIMO, 'excede el máximo permitido')
  .refine((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6, 'admite como máximo 2 decimales')
  // 30.299999999999997 llega de un cliente con error de coma flotante: se guarda y se compara como 30,30.
  .transform((valor) => Math.round(valor * 100) / 100);

const codigoGlobal = z.uuid('debe ser un UUID válido');

// Identificador del icono de la interfaz: texto corto en minúsculas, sin nada que pueda interpretarse como marcado.
const icono = z.string().regex(/^[a-z][a-z0-9_-]{0,29}$/, 'solo admite minúsculas, números, guion y guion bajo (máx. 30)');

export const parametrosMeta = z.strictObject({ idMeta: enteroPositivo });

export const cuerpoCrearMeta = z.strictObject({
  nombre: textoLibre(100),
  descripcion: textoLibre(250).optional(),
  icono: icono.optional(),
  montoObjetivo: monto,
  fechaLimite: z.iso.date('debe tener el formato AAAA-MM-DD'),
  codigoGlobal: codigoGlobal.optional(),
});

export const cuerpoOperacion = z.strictObject({
  monto,
  descripcion: textoLibre(150).optional(),
  codigoGlobal: codigoGlobal.optional(),
});

export const consultaMetas = z.strictObject({
  estado: z.enum(['EN_PROGRESO', 'COMPLETADA', 'PAUSADA', 'ATRASADA']).optional(),
});

export const consultaMovimientos = z.strictObject({
  pagina: enteroPositivo.pipe(z.number().max(100_000)).default(1),
  limite: enteroPositivo.pipe(z.number().max(50)).default(20),
  idMeta: enteroPositivo.optional(),
});

export type ParametrosMeta = z.output<typeof parametrosMeta>;
export type CuerpoCrearMeta = z.output<typeof cuerpoCrearMeta>;
export type CuerpoOperacion = z.output<typeof cuerpoOperacion>;
export type ConsultaMetas = z.output<typeof consultaMetas>;
export type ConsultaMovimientosEntrada = z.output<typeof consultaMovimientos>;
