import { z } from 'zod';

// Enteros positivos en texto plano: evita que Number() acepte "1e3", "0x10" o " 5".
const enteroPositivo = z
  .string()
  .regex(/^[1-9]\d{0,8}$/, 'debe ser un entero positivo')
  .transform(Number);

export const parametrosCategoria = z.strictObject({
  idCategoria: enteroPositivo,
});

export const consultaLecciones = z.strictObject({
  pagina: enteroPositivo.pipe(z.number().max(100_000)).default(1),
  limite: enteroPositivo.pipe(z.number().max(50)).default(20),
});

export type ParametrosCategoria = z.output<typeof parametrosCategoria>;
export type ConsultaLecciones = z.output<typeof consultaLecciones>;
