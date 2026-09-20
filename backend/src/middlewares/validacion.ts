import type { RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

interface EsquemasSolicitud {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

export interface DatosValidados<P = unknown, Q = unknown, B = unknown> {
  params: P;
  query: Q;
  body: B;
}

/**
 * Valida y normaliza params, query y body con esquemas Zod (usar `z.strictObject`
 * para rechazar campos desconocidos). Ante un dato inválido lanza ZodError, que el
 * manejador central convierte en un 400 sin reflejar los valores recibidos.
 * Los datos ya validados quedan en `res.locals.validado`.
 */
export function validar(esquemas: EsquemasSolicitud): RequestHandler {
  return (req, res, next) => {
    const validado: DatosValidados = {
      params: esquemas.params ? esquemas.params.parse(req.params) : {},
      query: esquemas.query ? esquemas.query.parse(req.query) : {},
      body: esquemas.body ? esquemas.body.parse(req.body) : {},
    };
    res.locals.validado = validado;
    next();
  };
}

/** Recupera, con su tipo, lo que dejó el middleware `validar`. */
export function obtenerValidado<P = unknown, Q = unknown, B = unknown>(res: Response): DatosValidados<P, Q, B> {
  return res.locals.validado as DatosValidados<P, Q, B>;
}
