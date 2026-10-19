# backend/

API REST de **GKMF** en **Node.js + Express 5 + TypeScript**, conectada a SQL Server.

- **Fase II:** estructura por capas, conexión a la base de datos, seguridad transversal y el módulo de lectura de educación financiera.
- **Fase III (esta versión):** cuentas (registro, inicio de sesión, renovación y cierre de sesión) y la **operación principal del sistema transaccional**: metas de ahorro con depósitos y retiros como transacciones ACID, historial de movimientos e idempotencia por código global.

## Requisitos

- Node.js **22.12 o superior** (probado en Node 24) y npm.
- La base de datos `GKMF` creada con los scripts de [`../database`](../database/README.md). Se recomienda ejecutar `04_seguridad_rol_api.sql` para usar la cuenta de mínimo privilegio `gkmf_api`.

## Puesta en marcha

```bash
cd backend
npm install
cp .env.example .env
```

Complete `.env` (las instrucciones están en el archivo): como mínimo `DB_PASSWORD` y `JWT_SECRET` (32 o más caracteres aleatorios). Si un valor contiene `#` o espacios, enciérrelo entre comillas dobles, porque `#` inicia un comentario en un archivo `.env`. Para usar la interfaz web desde otro origen, agregue ese origen exacto a `CORS_ORIGINS`.

```bash
npm run dev
```

El servidor escucha en `http://127.0.0.1:3000`. Si falta o es inseguro algún valor del entorno, **no arranca** y lista las variables inválidas (nunca sus valores).

## Scripts de npm

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga automática |
| `npm run build` / `npm start` | Compila a `dist/` y ejecuta la versión compilada |
| `npm run typecheck` | Verifica los tipos (`tsc --noEmit`) |
| `npm run lint` | ESLint con `typescript-eslint` |
| `npm test` | Pruebas unitarias y de rutas con dependencias simuladas (no requieren base de datos) |
| `npm run test:cov` | Igual, con informe de cobertura (umbral del 80 %; la lógica queda en ~96 %) |
| `npm run test:integracion` | Pruebas contra SQL Server real (requiere la BD y el `.env`) |
| `npm run test:integracion:cov` | Igual, con cobertura de la capa de datos |
| `npm run token:dev` | Emite un token de desarrollo (prohibido con `NODE_ENV=production`) |
| `npm run audit:prod` | Auditoría de las dependencias de producción |

La interfaz web tiene sus propias pruebas (`node --test "src/js/*.test.mjs"`, desde la raíz) y un recorrido de extremo a extremo con navegador (`node tests/e2e/flujo-metas.mjs`), descritos en el README de la raíz.

## Endpoints

Todas las respuestas usan el mismo formato: `{ "exito": true, "datos": … }` o `{ "exito": false, "error": { "codigo", "mensaje", "detalles?", "idSolicitud" } }`. **Todo lo que no sea `salud` o `auth` exige un token Bearer** (denegación por defecto).

| Método y ruta | Auth | Descripción |
|---|---|---|
| `GET /api/v1/salud` · `GET /api/v1/salud/listo` | No | Sondas de vida y de disponibilidad (con la base de datos) |
| `POST /api/v1/auth/registro` | No | CU-01. Crea una cuenta (`nombres`, `apellidos`, `correo`, `contrasena` de 12 a 128 caracteres). Responde 201; 409 si el correo ya existe |
| `POST /api/v1/auth/login` | No | CU-02/17/18. Devuelve `tokenAcceso` (15 min) y `tokenRefresco`. Tras 5 intentos fallidos bloquea la cuenta 15 minutos |
| `POST /api/v1/auth/refresco` | No | Renueva los tokens y **rota** el de refresco; presentar uno ya usado revoca todas las sesiones del usuario |
| `POST /api/v1/auth/cierre` | No | CU-03. Revoca el token de refresco (idempotente, 204) |
| `GET /api/v1/metas` | Sí | CU-06. Metas del usuario (`?estado=`) y su `resumen` (total ahorrado, metas por estado, promedio de avance, neto del mes) |
| `POST /api/v1/metas` | Sí | CU-05. Crea una meta (`nombre`, `montoObjetivo`, `fechaLimite` AAAA-MM-DD, `descripcion?`, `icono?`, `codigoGlobal?`). 201; 200 si es un reintento |
| `GET /api/v1/metas/:idMeta` | Sí | Detalle de una meta propia (404 si no existe **o es de otro usuario**) |
| `POST /api/v1/metas/:idMeta/depositos` | Sí | CU-09/19. Abono: actualiza el saldo y asienta el movimiento en una sola transacción |
| `POST /api/v1/metas/:idMeta/retiros` | Sí | CU-10/20. Retiro con validación de saldo; 409 `SALDO_INSUFICIENTE` si no alcanza |
| `GET /api/v1/movimientos` | Sí | CU-11. Historial paginado del usuario (`pagina`, `limite` ≤ 50, `idMeta?`) |
| `GET /api/v1/educacion/categorias` | Sí | Categorías de lecciones con su número de lecciones |
| `GET /api/v1/educacion/categorias/:idCategoria/lecciones` | Sí | Lecciones de una categoría, paginadas |

Ejemplo (los valores de `codigoGlobal` hacen la operación **idempotente**: repetirla devuelve 200 con el mismo resultado y no duplica nada):

```bash
curl -X POST http://127.0.0.1:3000/api/v1/auth/login -H "Content-Type: application/json" \
     -d '{"correo":"ana@example.com","contrasena":"mi-clave-larga-123"}'
curl -X POST http://127.0.0.1:3000/api/v1/metas/1/depositos -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" -d '{"monto":20000,"codigoGlobal":"6f1c2a6e-4b0e-4c3a-9d1e-0a5b6c7d8e9f"}'
```

## Arquitectura

```
src/
├── server.ts               # arranque, señales y apagado ordenado
├── composicion.ts          # raíz de composición: conecta las piezas reales
├── app.ts                  # crea la aplicación Express (middlewares y rutas)
├── config/entorno.ts       # validación estricta de variables de entorno (Zod)
├── db/conexion.ts          # pool de conexiones y transacciones ACID (conTransaccion)
├── middlewares/            # seguridad (Helmet, CORS, límites), autenticación, validación, errores
├── modulos/
│   ├── salud/              # sondas de estado
│   ├── educacion/          # rutas → servicio → repositorio (patrón de referencia)
│   ├── cuentas/            # registro, login, refresco y cierre de sesión
│   └── metas/              # metas de ahorro, depósitos, retiros e historial (la operación ACID)
├── seguridad/
│   ├── tokens.ts           # JWT (HS256) con emisor, audiencia y expiración
│   ├── contrasena.ts       # hash de contraseñas con scrypt
│   └── limitador.ts        # tope de hashes simultáneos (protege memoria y CPU)
└── utilidades/logger.ts    # registro estructurado con redacción de datos sensibles
```

Cada módulo sigue las capas **rutas → servicio → repositorio**: la ruta valida (Zod estricto) y da formato a la respuesta, el servicio contiene las reglas de negocio y el repositorio es el único que toca SQL. Todo se inyecta, así que cada capa se prueba de forma aislada.

### Cómo se garantiza ACID en un depósito o retiro

`metas.repositorio.ts → registrarMovimiento` ejecuta, dentro de **una** transacción (`conTransaccion`):

1. **Bloquea la fila de la meta** (`UPDLOCK`). Todas las operaciones sobre una meta se ponen en fila desde aquí y toman los recursos en un orden fijo (meta, luego libro mayor). Sin este paso, las pruebas de concurrencia detectaron **interbloqueos** (error 1205) cuando una solicitud leía el libro mientras otra ya tenía la meta bloqueada.
2. Comprueba si el `codigoGlobal` ya se procesó (idempotencia) y, si es así, devuelve el resultado anterior.
3. Cambia el saldo con **una sola sentencia** que incluye la regla de negocio (`monto_ahorrado >= @monto` al retirar) y recalcula el estado (`COMPLETADA` ↔ `EN_PROGRESO`).
4. Inserta el movimiento en `transaccion` (libro mayor de solo inserción). Si algo falla, el saldo también se revierte.

Como defensa adicional, ante una violación de `UQ_transaccion_codigo_global` o un interbloqueo se repite la operación completa (hasta 3 intentos), lo cual es seguro por ser idempotente.

## Seguridad implementada

- **Validación de configuración al arrancar:** falla rápido; en producción exige conexión cifrada y prohíbe certificados autofirmados.
- **Autenticación por defecto:** todo lo que no sea `/salud` o `/auth` exige un token Bearer válido.
- **JWT:** algoritmo fijado (HS256), emisor, audiencia y expiración obligatorios, vida corta (15 min por defecto).
- **Contraseñas:** `scrypt` con sal única, normalización Unicode NFKC, 12 a 128 caracteres y comparación en tiempo constante. Un tope de 2 hashes simultáneos evita agotar la memoria.
- **Sin enumeración de usuarios:** correo inexistente, contraseña incorrecta, cuenta bloqueada o desactivada responden **lo mismo**; con un correo inexistente se ejecuta un hash ficticio para igualar el tiempo de respuesta.
- **Bloqueo de cuenta (CU-18):** 5 intentos fallidos bloquean 15 minutos (configurable); el contador se actualiza con una sola sentencia SQL, sin carreras.
- **Sesiones:** el token de refresco es opaco (256 bits), solo se guarda su **SHA-256**, se **rota** en cada renovación y reutilizar uno revocado cierra todas las sesiones del usuario.
- **Límites propios para `/auth`:** 20 solicitudes por IP cada 15 minutos (aparte del límite general).
- **Aislamiento entre usuarios (OWASP API1, BOLA):** el `idUsuario` sale **siempre del token**, nunca del cuerpo ni de la URL, y forma parte de cada condición SQL; la meta de otro usuario responde 404 como si no existiera. Las cuentas desactivadas no pueden operar aunque su token siga vigente.
- **Entradas:** esquemas Zod estrictos (rechazan campos desconocidos, montos con más de 2 decimales, caracteres de control y marcado en nombres) y errores que no reflejan el valor recibido.
- **SQL:** consultas de texto fijo con parámetros tipados; se listan las columnas explícitamente.
- **Cabeceras y límites:** Helmet (CSP restrictiva), CORS con lista blanca exacta, límite de solicitudes por IP, cuerpo máximo de 100 kB, `Cache-Control: no-store`.
- **Registro:** `pino` con redacción de `Authorization`, contraseñas, hashes y tokens.
- **Base de datos:** conexión con cuenta de mínimo privilegio; el libro de movimientos es de solo inserción.

## Pruebas

| Capa | Comando | Qué cubre | Resultado verificado (2026-10-18) |
|---|---|---|---|
| Unitarias y de rutas | `npm run test:cov` | Servicios con repositorios simulados, contrato HTTP de cada endpoint, validación estricta, límites, 401/403/404/409, BOLA | **214 pruebas**; cobertura de la lógica 96,2 % (sentencias) y 90,5 % (ramas) |
| Integración | `npm run test:integracion` | SQL Server real: registro, bloqueo, rotación de tokens, ACID, **concurrencia**, idempotencia, atomicidad, invariante saldo = depósitos − retiros | **50 pruebas** |

Los repositorios (SQL) se excluyen del umbral unitario porque solo tienen sentido contra el motor real; su cobertura se mide con `npm run test:integracion:cov`. Las pruebas de integración dejan datos de prueba en la base (la cuenta de la API no puede borrar filas); usan el dominio reservado `example.com`.

## Con Docker

Desde la raíz del repositorio: `docker compose --profile api up -d --build api`. La imagen es multietapa, corre como usuario no root con sistema de archivos de solo lectura y sin capacidades de Linux.

## Pendiente (siguientes fases)

Sincronización idempotente por lotes (`sincronizacion`), movimientos de ingreso y egreso por categoría (CU-08), pausar y editar metas (CU-07), progreso de lecciones y logros (CU-13, 14, 21), perfil y configuración (CU-04), administración del contenido educativo (CU-16), procedimientos almacenados con `EXECUTE AS OWNER` para el saldo, integración continua y TLS en un proxy.
