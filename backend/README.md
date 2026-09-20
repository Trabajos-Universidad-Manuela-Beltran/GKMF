# backend/

API REST de **GKMF** en **Node.js + Express 5 + TypeScript**, conectada a SQL Server. Es la **estructura inicial** de la Fase II: deja lista la organización por capas, la conexión a la base de datos, la seguridad transversal y un primer módulo de lectura (educación financiera). Las operaciones transaccionales (metas, movimientos, sincronización) y el inicio de sesión se construyen en la Fase III sobre esta base.

## Requisitos

- Node.js **22.12 o superior** (probado en Node 24) y npm.
- La base de datos `GKMF` creada con los scripts de [`../database`](../database/README.md). Se recomienda ejecutar `04_seguridad_rol_api.sql` para usar la cuenta de mínimo privilegio `gkmf_api`.

## Puesta en marcha

```bash
cd backend
npm install
cp .env.example .env
```

Complete `.env` (las instrucciones están en el archivo): como mínimo `DB_PASSWORD` y `JWT_SECRET` (32 o más caracteres aleatorios). Si un valor contiene `#` o espacios, enciérrelo entre comillas dobles, porque `#` inicia un comentario en un archivo `.env`.

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
| `npm test` | Pruebas unitarias y de API con dependencias simuladas (no requieren base de datos) |
| `npm run test:cov` | Igual, con informe de cobertura (umbral del 80 %) |
| `npm run test:integracion` | Pruebas contra SQL Server real (requiere la BD y el `.env`) |
| `npm run token:dev` | Emite un token de desarrollo para probar la API (prohibido con `NODE_ENV=production`) |
| `npm run audit:prod` | Auditoría de las dependencias de producción |

## Probar la API a mano

```bash
curl http://127.0.0.1:3000/api/v1/salud
curl http://127.0.0.1:3000/api/v1/salud/listo
TOKEN=$(npm run -s token:dev)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/v1/educacion/categorias
curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/api/v1/educacion/categorias/1/lecciones?limite=5"
```

## Endpoints actuales

| Método y ruta | Auth | Descripción |
|---|---|---|
| `GET /api/v1/salud` | No | Sonda de vida (el proceso responde) |
| `GET /api/v1/salud/listo` | No | Sonda de disponibilidad (el proceso y la base de datos responden) |
| `GET /api/v1/educacion/categorias` | Sí | Categorías de lecciones con su número de lecciones |
| `GET /api/v1/educacion/categorias/:idCategoria/lecciones` | Sí | Lecciones de una categoría, paginadas (`pagina`, `limite` ≤ 50) |

Todas las respuestas usan el mismo formato: `{ "exito": true, "datos": … }` o `{ "exito": false, "error": { "codigo", "mensaje", "idSolicitud" } }`.

## Arquitectura

```
src/
├── server.ts               # arranque, señales y apagado ordenado
├── composicion.ts          # raíz de composición: conecta las piezas reales
├── app.ts                  # crea la aplicación Express (middlewares y rutas)
├── config/entorno.ts       # validación estricta de variables de entorno (Zod)
├── db/conexion.ts          # pool de conexiones y transacciones ACID (conTransaccion)
├── middlewares/
│   ├── seguridad.ts        # Helmet, CORS, límite de solicitudes, ID de solicitud
│   ├── autenticacion.ts    # verificación del JWT y autorización por rol
│   ├── validacion.ts       # validación de params, query y body con Zod
│   └── errores.ts          # manejo central de errores sin fugas de información
├── modulos/
│   ├── salud/              # sondas de estado
│   └── educacion/          # rutas → servicio → repositorio (patrón de referencia)
├── seguridad/
│   ├── tokens.ts           # JWT (HS256) con emisor, audiencia y expiración
│   └── contrasena.ts       # hash de contraseñas con scrypt
└── utilidades/logger.ts    # registro estructurado con redacción de datos sensibles
```

Cada módulo sigue las capas **rutas/controlador → servicio → repositorio**: la ruta valida y da formato a la respuesta, el servicio contiene las reglas de negocio y el repositorio es el único que toca SQL. La conexión y los servicios se inyectan, lo que permite probar cada capa de forma aislada.

## Seguridad implementada

- **Validación de configuración al arrancar:** falla rápido; en producción exige conexión cifrada y prohíbe certificados autofirmados.
- **Autenticación por defecto:** todo lo que no sea `/salud` exige un token Bearer válido.
- **JWT:** algoritmo fijado (HS256), emisor, audiencia y expiración obligatorios, vida corta (15 min por defecto).
- **Contraseñas:** `scrypt` con sal única por contraseña y comparación en tiempo constante.
- **Entradas:** esquemas Zod estrictos que rechazan campos desconocidos y no reflejan el valor recibido en los errores.
- **SQL:** consultas de texto fijo con parámetros tipados; se listan las columnas explícitamente (nunca `SELECT *`).
- **Cabeceras y límites:** Helmet (CSP restrictiva), CORS con lista blanca exacta, límite de solicitudes por IP, cuerpo máximo de 100 kB, `Cache-Control: no-store`.
- **Errores:** los fallos internos devuelven un mensaje genérico; el detalle solo va al registro del servidor.
- **Registro:** `pino` con redacción de `Authorization`, contraseñas, hashes y tokens; nunca se registran cabeceras completas ni la cadena de consulta.
- **Base de datos:** conexión con cuenta de mínimo privilegio; los movimientos son de solo inserción.

## Pruebas

- `tests/unit/` — entorno, contraseñas, tokens, autorización, servicio de educación y API completa (cabeceras de seguridad, 401/403/404/400/413/429, CORS, no fuga de errores) con dependencias simuladas.
- `tests/integration/` — contra SQL Server real: cuenta sin privilegios administrativos, `DENY DELETE`, SQL inyectado tratado como dato, atomicidad (`ROLLBACK`) de `conTransaccion`, nivel de aislamiento y endpoints de educación con los datos iniciales.

## Con Docker

Desde la raíz del repositorio: `docker compose --profile api up -d --build api`. La imagen es multietapa, corre como usuario no root con sistema de archivos de solo lectura y sin capacidades de Linux.

## Próximos pasos (Fase III)

Registro, inicio y cierre de sesión (tokens de refresco sobre la tabla `sesion`, bloqueo por intentos fallidos); metas y movimientos como transacciones ACID sobre `conTransaccion`; endpoint de sincronización idempotente; administración del contenido educativo.
