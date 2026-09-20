import type { Identidad } from '../seguridad/tokens.js';

declare global {
  namespace Express {
    interface Request {
      /** Identificador de correlación de la solicitud (también viaja en X-Request-Id). */
      id: string;
      /** Usuario autenticado; solo existe después del middleware `autenticar`. */
      identidad?: Identidad;
    }
  }
}

export {};
