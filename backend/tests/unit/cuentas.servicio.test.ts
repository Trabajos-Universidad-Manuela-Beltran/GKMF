import { createHash } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RepositorioCuentas, SesionFila, UsuarioFila } from '../../src/modulos/cuentas/cuentas.repositorio.js';
import { crearServicioCuentas, type ServicioCuentas } from '../../src/modulos/cuentas/cuentas.servicio.js';
import { ErrorAplicacion } from '../../src/middlewares/errores.js';

const CONFIG = { REFRESH_TTL_DAYS: 7, LOGIN_MAX_ATTEMPTS: 5, LOGIN_LOCK_MINUTES: 15, JWT_ACCESS_TTL_SECONDS: 900 };

/** Hash simulado: rápido y determinista (el hash real, scrypt, se prueba en contrasena.test.ts). */
const hashFalso = {
  hashear: vi.fn(async (clave: string) => `hash(${clave})`),
  verificar: vi.fn(async (clave: string, almacenado: string) => almacenado === `hash(${clave})`),
};

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

function usuario(sobrescribir: Partial<UsuarioFila> = {}): UsuarioFila {
  return {
    id_usuario: 7,
    nombres: 'Ana María',
    apellidos: 'Pérez',
    correo: 'ana@example.com',
    hash_contrasena: 'hash(clave-segura-123)',
    rol: 'USUARIO',
    activo: true,
    bloqueada: false,
    fecha_registro: new Date('2026-10-01T10:00:00Z'),
    ...sobrescribir,
  };
}

function repositorioFalso(sobrescribir: Partial<RepositorioCuentas> = {}): RepositorioCuentas {
  return {
    crearUsuario: vi.fn(async (datos) => usuario({ nombres: datos.nombres, apellidos: datos.apellidos, correo: datos.correo, hash_contrasena: datos.hashContrasena })),
    buscarPorCorreo: vi.fn(async () => usuario()),
    buscarPorId: vi.fn(async () => usuario()),
    registrarIntentoFallido: vi.fn(async () => undefined),
    registrarAccesoExitoso: vi.fn(async () => true),
    crearSesion: vi.fn(async () => undefined),
    buscarSesion: vi.fn(async () => null),
    rotarSesion: vi.fn(async () => true),
    revocarSesion: vi.fn(async () => undefined),
    revocarSesionesDeUsuario: vi.fn(async () => undefined),
    ...sobrescribir,
  };
}

const emitir = vi.fn(async (identidad: { idUsuario: number; rol: string }) => `acceso-${identidad.idUsuario}-${identidad.rol}`);

function crearServicio(repositorio: RepositorioCuentas): ServicioCuentas {
  return crearServicioCuentas({ repositorio, tokens: { emitir }, config: CONFIG, hash: hashFalso });
}

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

describe('ServicioCuentas.registrar', () => {
  it('normaliza el correo, guarda solo el hash y no devuelve datos sensibles', async () => {
    const repositorio = repositorioFalso();
    const creado = await crearServicio(repositorio).registrar({
      nombres: 'Ana María',
      apellidos: 'Pérez',
      correo: 'ANA@Example.com',
      contrasena: 'clave-segura-123',
    });

    expect(repositorio.crearUsuario).toHaveBeenCalledWith({
      nombres: 'Ana María',
      apellidos: 'Pérez',
      correo: 'ana@example.com',
      hashContrasena: 'hash(clave-segura-123)',
    });
    expect(creado).toEqual({
      id: 7,
      nombres: 'Ana María',
      apellidos: 'Pérez',
      correo: 'ana@example.com',
      rol: 'USUARIO',
      fechaRegistro: '2026-10-01T10:00:00.000Z',
    });
    expect(JSON.stringify(creado)).not.toContain('hash');
  });

  it('normaliza la contraseña a NFKC antes de hashearla (la misma clave se escribe igual desde cualquier teclado)', async () => {
    const repositorio = repositorioFalso();
    await crearServicio(repositorio).registrar({ nombres: 'A', apellidos: 'B', correo: 'a@b.co', contrasena: 'ｃｌａｖｅ-ancha-1234' });
    expect(hashFalso.hashear).toHaveBeenCalledWith('clave-ancha-1234');
  });

  it('propaga el 409 cuando el correo ya está registrado', async () => {
    const repositorio = repositorioFalso({
      crearUsuario: vi.fn(async () => {
        throw new ErrorAplicacion(409, 'CORREO_YA_REGISTRADO', 'Ya existe una cuenta con ese correo.');
      }),
    });
    const error = await esperarError(crearServicio(repositorio).registrar({ nombres: 'A', apellidos: 'B', correo: 'a@b.co', contrasena: 'clave-segura-123' }));
    expect(error.estado).toBe(409);
    expect(error.codigo).toBe('CORREO_YA_REGISTRADO');
  });
});

describe('ServicioCuentas.iniciarSesion', () => {
  it('con credenciales correctas entrega tokens, reinicia los intentos y guarda solo el hash del token de refresco', async () => {
    const repositorio = repositorioFalso();
    const sesion = await crearServicio(repositorio).iniciarSesion({ correo: 'ana@example.com', contrasena: 'clave-segura-123' });

    expect(sesion.tokenAcceso).toBe('acceso-7-USUARIO');
    expect(sesion.tipoToken).toBe('Bearer');
    expect(sesion.expiraEnSegundos).toBe(900);
    expect(sesion.tokenRefresco).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sesion.usuario).toMatchObject({ id: 7, correo: 'ana@example.com', rol: 'USUARIO' });

    expect(repositorio.registrarAccesoExitoso).toHaveBeenCalledWith(7);
    const [idUsuario, hashGuardado, dias] = vi.mocked(repositorio.crearSesion).mock.calls[0] as [number, string, number];
    expect(idUsuario).toBe(7);
    expect(hashGuardado).toBe(sha256(sesion.tokenRefresco));
    expect(hashGuardado).not.toContain(sesion.tokenRefresco);
    expect(dias).toBe(7);
  });

  it('con contraseña incorrecta registra el intento y responde un 401 genérico', async () => {
    const repositorio = repositorioFalso();
    const error = await esperarError(crearServicio(repositorio).iniciarSesion({ correo: 'ana@example.com', contrasena: 'otra-clave-distinta' }));
    expect(error.estado).toBe(401);
    expect(error.codigo).toBe('CREDENCIALES_INVALIDAS');
    expect(repositorio.registrarIntentoFallido).toHaveBeenCalledWith(7, 5, 15);
    expect(repositorio.crearSesion).not.toHaveBeenCalled();
    expect(emitir).not.toHaveBeenCalled();
  });

  it('con un correo inexistente responde lo mismo y ejecuta una verificación ficticia (mismo tiempo de respuesta)', async () => {
    const repositorio = repositorioFalso({ buscarPorCorreo: vi.fn(async () => null) });
    const servicio = crearServicio(repositorio);
    const inexistente = await esperarError(servicio.iniciarSesion({ correo: 'nadie@example.com', contrasena: 'clave-segura-123' }));
    // Con el correo inexistente se gastó UN hash de comprobación (lo que cuenta para el tiempo de respuesta), no cero.
    expect(hashFalso.verificar).toHaveBeenCalledTimes(1);
    const incorrecta = await esperarError(crearServicio(repositorioFalso()).iniciarSesion({ correo: 'ana@example.com', contrasena: 'otra-clave-distinta' }));

    expect({ estado: inexistente.estado, codigo: inexistente.codigo, mensaje: inexistente.message }).toEqual({
      estado: incorrecta.estado,
      codigo: incorrecta.codigo,
      mensaje: incorrecta.message,
    });
    expect(hashFalso.verificar).toHaveBeenCalled(); // se gastó el mismo trabajo que con un usuario real
    expect(repositorio.registrarIntentoFallido).not.toHaveBeenCalled();
  });

  it('con la cuenta bloqueada rechaza sin siquiera comprobar la contraseña y sin sumar intentos', async () => {
    const repositorio = repositorioFalso({ buscarPorCorreo: vi.fn(async () => usuario({ bloqueada: true })) });
    const error = await esperarError(crearServicio(repositorio).iniciarSesion({ correo: 'ana@example.com', contrasena: 'clave-segura-123' }));
    expect(error.estado).toBe(401);
    expect(error.codigo).toBe('CREDENCIALES_INVALIDAS');
    expect(repositorio.registrarIntentoFallido).not.toHaveBeenCalled();
    expect(repositorio.crearSesion).not.toHaveBeenCalled();
  });

  it('con la cuenta desactivada rechaza aunque la contraseña sea correcta', async () => {
    const repositorio = repositorioFalso({ buscarPorCorreo: vi.fn(async () => usuario({ activo: false })) });
    const error = await esperarError(crearServicio(repositorio).iniciarSesion({ correo: 'ana@example.com', contrasena: 'clave-segura-123' }));
    expect(error.codigo).toBe('CREDENCIALES_INVALIDAS');
    expect(repositorio.crearSesion).not.toHaveBeenCalled();
  });
});

describe('ServicioCuentas.iniciarSesion: carreras y fallos transitorios', () => {
  it('no abre sesión si la cuenta se bloqueó o desactivó entre la lectura y el acceso (la sentencia SQL lo rechaza)', async () => {
    const repositorio = repositorioFalso({ registrarAccesoExitoso: vi.fn(async () => false) });
    const error = await esperarError(crearServicio(repositorio).iniciarSesion({ correo: 'ana@example.com', contrasena: 'clave-segura-123' }));
    expect(error.codigo).toBe('CREDENCIALES_INVALIDAS');
    expect(repositorio.crearSesion).not.toHaveBeenCalled();
    expect(emitir).not.toHaveBeenCalled();
  });

  it('si el hash ficticio falla una vez, el fallo no queda guardado: el siguiente intento con un correo inexistente responde 401', async () => {
    const hashQueFallaUnaVez = {
      hashear: vi.fn().mockRejectedValueOnce(new Error('cola llena')).mockResolvedValue('hash(ficticio)'),
      verificar: vi.fn(async () => false),
    };
    const repositorio = repositorioFalso({ buscarPorCorreo: vi.fn(async () => null) });
    const servicio = crearServicioCuentas({ repositorio, tokens: { emitir }, config: CONFIG, hash: hashQueFallaUnaVez });

    await expect(servicio.iniciarSesion({ correo: 'nadie@example.com', contrasena: 'clave-segura-123' })).rejects.toThrow('cola llena');
    const segunda = await esperarError(servicio.iniciarSesion({ correo: 'nadie@example.com', contrasena: 'clave-segura-123' }));
    expect(segunda.estado).toBe(401);
    expect(hashQueFallaUnaVez.hashear).toHaveBeenCalledTimes(2);
  });
});

describe('ServicioCuentas.renovar', () => {
  const tokenViejo = 'A'.repeat(43);
  const sesionActiva: SesionFila = { id_sesion: 11, id_usuario: 7, revocada: false, vigente: true };

  it('rota el token: revoca el anterior, crea uno nuevo distinto y emite un nuevo token de acceso', async () => {
    const repositorio = repositorioFalso({ buscarSesion: vi.fn(async () => sesionActiva) });
    const renovada = await crearServicio(repositorio).renovar(tokenViejo);

    expect(repositorio.buscarSesion).toHaveBeenCalledWith(sha256(tokenViejo));
    expect(renovada.tokenAcceso).toBe('acceso-7-USUARIO');
    expect(renovada.tokenRefresco).not.toBe(tokenViejo);
    expect(renovada.tokenRefresco).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repositorio.rotarSesion).toHaveBeenCalledWith(11, 7, sha256(renovada.tokenRefresco), 7);
  });

  it('rechaza un token desconocido', async () => {
    const error = await esperarError(crearServicio(repositorioFalso()).renovar(tokenViejo));
    expect(error.estado).toBe(401);
    expect(error.codigo).toBe('TOKEN_REFRESCO_INVALIDO');
  });

  it('ante la reutilización de un token ya revocado revoca TODAS las sesiones del usuario (posible robo)', async () => {
    const repositorio = repositorioFalso({ buscarSesion: vi.fn(async () => ({ ...sesionActiva, revocada: true })) });
    const error = await esperarError(crearServicio(repositorio).renovar(tokenViejo));
    expect(error.codigo).toBe('TOKEN_REFRESCO_INVALIDO');
    expect(repositorio.revocarSesionesDeUsuario).toHaveBeenCalledWith(7);
    expect(repositorio.rotarSesion).not.toHaveBeenCalled();
  });

  it('rechaza un token vencido sin revocar nada más', async () => {
    const repositorio = repositorioFalso({ buscarSesion: vi.fn(async () => ({ ...sesionActiva, vigente: false })) });
    const error = await esperarError(crearServicio(repositorio).renovar(tokenViejo));
    expect(error.codigo).toBe('TOKEN_REFRESCO_INVALIDO');
    expect(repositorio.revocarSesionesDeUsuario).not.toHaveBeenCalled();
    expect(repositorio.rotarSesion).not.toHaveBeenCalled();
  });

  it('no renueva si el usuario fue desactivado y cierra todas sus sesiones', async () => {
    const repositorio = repositorioFalso({
      buscarSesion: vi.fn(async () => sesionActiva),
      buscarPorId: vi.fn(async () => usuario({ activo: false })),
    });
    const error = await esperarError(crearServicio(repositorio).renovar(tokenViejo));
    expect(error.codigo).toBe('TOKEN_REFRESCO_INVALIDO');
    expect(repositorio.revocarSesionesDeUsuario).toHaveBeenCalledWith(7);
  });

  it('si dos solicitudes presentan el mismo token a la vez, solo una gana; la otra se trata como reutilización', async () => {
    const repositorio = repositorioFalso({ buscarSesion: vi.fn(async () => sesionActiva), rotarSesion: vi.fn(async () => false) });
    const error = await esperarError(crearServicio(repositorio).renovar(tokenViejo));
    expect(error.codigo).toBe('TOKEN_REFRESCO_INVALIDO');
    expect(repositorio.revocarSesionesDeUsuario).toHaveBeenCalledWith(7);
    expect(emitir).not.toHaveBeenCalled();
  });
});

describe('ServicioCuentas.cerrarSesion', () => {
  it('revoca la sesión por el hash del token y es idempotente (no falla con un token desconocido)', async () => {
    const repositorio = repositorioFalso();
    const token = 'B'.repeat(43);
    await expect(crearServicio(repositorio).cerrarSesion(token)).resolves.toBeUndefined();
    expect(repositorio.revocarSesion).toHaveBeenCalledWith(sha256(token));
  });
});
