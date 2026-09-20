import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { autorizar } from '../../src/middlewares/autenticacion.js';
import { ErrorAplicacion } from '../../src/middlewares/errores.js';
import type { Identidad } from '../../src/seguridad/tokens.js';

const invocar = (identidad: Identidad | undefined, ...roles: Parameters<typeof autorizar>) => {
  const siguiente = vi.fn() as unknown as NextFunction;
  const solicitud = { identidad } as Request;
  autorizar(...roles)(solicitud, {} as Response, siguiente);
  return siguiente;
};

describe('autorizar por rol', () => {
  it('permite el acceso a un rol autorizado', () => {
    const siguiente = invocar({ idUsuario: 1, rol: 'ADMINISTRADOR' }, 'ADMINISTRADOR');
    expect(siguiente).toHaveBeenCalledOnce();
  });

  it('deniega (403) a un rol no autorizado', () => {
    expect(() => invocar({ idUsuario: 2, rol: 'USUARIO' }, 'ADMINISTRADOR')).toThrow(
      expect.objectContaining({ estado: 403, codigo: 'ACCESO_DENEGADO' }),
    );
  });

  it('exige identidad previa: sin autenticar responde 401', () => {
    expect(() => invocar(undefined, 'USUARIO')).toThrow(ErrorAplicacion);
    expect(() => invocar(undefined, 'USUARIO')).toThrow(expect.objectContaining({ estado: 401 }));
  });
});
