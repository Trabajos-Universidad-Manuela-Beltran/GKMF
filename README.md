# GKMF — Garantía de Conocimiento y Movilidad Financiera

**Estado:** `En desarrollo` | **Versión:** `0.2.0` (Fase II) | **Plataforma:** Móvil (Android / iOS)

---

## Descripción

GKMF es una aplicación móvil orientada a la **inclusión financiera en Colombia**. Su propósito es acompañar a personas con acceso limitado al sistema financiero formal para que puedan registrar sus ingresos y gastos, establecer metas de ahorro, acceder a educación financiera básica y operar desde zonas con conectividad reducida gracias a su modo offline.

El diseño del sistema está guiado por los **principios ACID** para garantizar la integridad de cada transacción registrada, y sigue una arquitectura orientada a la simplicidad, la seguridad y la confianza del usuario final.

---

## Módulos del sistema

| Módulo | Descripción |
|---|---|
| **Metas de Ahorro** | Creación, seguimiento y cierre de objetivos de ahorro con montos y fechas límite |
| **Registro de Transacciones** | Captura de ingresos, egresos, depósitos y retiros de metas, con soporte offline |
| **Educación Financiera** | Lecciones cortas sobre ahorro, presupuesto, crédito e inversión básica, con progreso y logros |
| **Modo Offline** | Sincronización diferida e idempotente; el usuario puede registrar datos sin conexión |

---

## Principios ACID aplicados

- **Atomicidad:** cada transacción se registra completa o no se registra; no existen estados intermedios persistidos.
- **Consistencia:** las reglas de negocio (saldo nunca negativo, metas con monto válido) se validan antes de confirmar cualquier escritura y se refuerzan con restricciones `CHECK` y claves foráneas en la base de datos.
- **Aislamiento:** las operaciones concurrentes (sincronización offline + escritura local) no producen lecturas sucias ni conflictos silenciosos.
- **Durabilidad:** una vez confirmado un registro, persiste aunque la aplicación se cierre o el dispositivo pierda energía.

---

## Evolución del proyecto por fases

| Fase | Entregable | Ubicación |
|---|---|---|
| **I** | Prototipo de interfaz (5 pantallas, WCAG 2.2 AA) y documento de contextualización | [`src/`](src/) |
| **II — Documentación** | Análisis y diseño: arquitectura, casos de uso, diagrama de clases y modelo relacional (PDF) | [`docs/`](docs/) |
| **II — Repositorio** | Base de datos inicial (SQL Server) y estructura inicial del backend | [`database/`](database/), [`backend/`](backend/) |
| III (siguiente) | Operaciones transaccionales, autenticación completa, sincronización y app móvil | — |

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Interfaz móvil | React Native o Flutter (se define en la Fase III); prototipo en HTML5 + CSS3 + JavaScript vanilla |
| Base de datos local (offline) | SQLite |
| **Base de datos central** | **Microsoft SQL Server (T-SQL)** |
| **Backend** | **Node.js + Express + TypeScript** (API REST versionada en `/api/v1`) |
| Seguridad | JWT (`jose`), `scrypt`, validación con Zod, Helmet, `express-rate-limit`, cuenta SQL de mínimo privilegio |
| Notificaciones | Firebase Cloud Messaging (opcional) |
| Entorno | Docker Compose |

> **Cambio frente a la Fase I:** el almacén principal pasó de Firebase Firestore a SQL Server. Un modelo transaccional con claves primarias y foráneas, restricciones de integridad y transacciones ACID no puede apoyarse en una base documental. SQLite se conserva como réplica local en el dispositivo y Firebase Cloud Messaging se mantiene para las notificaciones. La justificación completa está en la sección 4.7 de la documentación de la Fase II.

---

## Estructura del proyecto

```
GKMF-Garant-a-de-Conocimiento-y-Movilidad-Financiera/
├── README.md
├── LICENSE
├── docker-compose.yml        # SQL Server + inicialización de la BD + API
├── .env.example              # variables para docker compose (sin secretos)
├── database/                 # Scripts T-SQL: crear BD, tablas, datos, seguridad, pruebas
│   ├── 01_crear_base_datos.sql
│   ├── 02_crear_tablas.sql
│   ├── 03_datos_iniciales.sql
│   ├── 04_seguridad_rol_api.sql
│   ├── 90_eliminar_esquema.sql
│   ├── 98_pruebas_integridad.sql
│   ├── 99_verificacion.sql
│   ├── docker/inicializar.sh
│   └── README.md
├── backend/                  # API REST (Node.js + Express + TypeScript)
│   ├── src/                  # config, db, middlewares, modulos, seguridad, utilidades
│   ├── tests/                # unitarias y de integración
│   ├── Dockerfile
│   └── README.md
├── docs/                     # Documentación de la Fase II (PDF) y diagramas
└── src/                      # Prototipo de interfaz de la Fase I (HTML/CSS/JS)
    ├── templates/index.html
    ├── styles/
    └── js/
```

---

## Puesta en marcha

### Requisitos

- **Docker Desktop** (opción A) **o** una instancia de **SQL Server 2019+** con SSMS (opción B).
- **Node.js 22.12 o superior** para ejecutar el backend fuera de Docker.

### Opción A — Docker (recomendada)

```bash
cp .env.example .env
```

Edite `.env` y defina `MSSQL_SA_PASSWORD`, `GKMF_API_PASSWORD` y `JWT_SECRET` (las instrucciones están en el propio archivo). Si un valor contiene `#` o espacios, enciérrelo entre comillas dobles. Luego:

```bash
docker compose up -d db db-init
docker compose --profile api up -d --build api
```

`db-init` crea la base de datos `GKMF`, las tablas, los datos de prueba y la cuenta `gkmf_api` de mínimo privilegio, y termina con una verificación. Para comprobar que la API responde:

```bash
curl http://localhost:3000/api/v1/salud
```

### Opción B — SQL Server local con SSMS

1. Conéctese a su instancia con SSMS.
2. Abra y ejecute, en este orden, `database/01_crear_base_datos.sql`, `02_crear_tablas.sql` y `03_datos_iniciales.sql`.
3. (Opcional, recomendado) Ejecute `04_seguridad_rol_api.sql` para crear la cuenta de mínimo privilegio que usa el backend; el script explica cómo definir la contraseña.
4. Compruebe el resultado con `99_verificacion.sql` y `98_pruebas_integridad.sql`.
5. Para el backend: entre en `backend/`, copie `.env.example` a `.env`, complételo y ejecute `npm install` y `npm run dev`.

Los detalles de cada script están en [`database/README.md`](database/README.md) y los del backend en [`backend/README.md`](backend/README.md).

---

## Base de datos

El modelo relacional tiene **11 tablas**, **12 claves foráneas** (2 compuestas), **11 restricciones UNIQUE** y **23 restricciones CHECK**, todas con nombre explícito. Las tablas son: `usuario`, `sesion`, `meta_ahorro`, `categoria_movimiento`, `transaccion`, `sincronizacion`, `categoria_leccion`, `leccion`, `progreso_leccion`, `logro` y `usuario_logro`.

Decisiones destacadas:

- **Aislamiento entre usuarios en la propia base de datos:** las claves foráneas compuestas `(id_meta, id_usuario)` e `(id_sincronizacion, id_usuario)` impiden que un movimiento de un usuario apunte a datos de otro.
- **Libro de movimientos de solo inserción:** la cuenta de la API no puede modificar ni borrar filas de `transaccion`.
- **Saldo nunca negativo** y `monto` siempre positivo, aplicados con restricciones `CHECK`.
- **Sincronización idempotente:** `codigo_global` (GUID) único evita duplicar movimientos creados sin conexión.

El script `98_pruebas_integridad.sql` intenta 29 operaciones inválidas y comprueba que el motor rechace cada una.

---

## Seguridad

- Contraseñas con `scrypt` y sal única (`backend/src/seguridad/contrasena.ts`); nunca se guardan en claro.
- Tokens JWT de vida corta con algoritmo fijo, emisor, audiencia y expiración obligatorios.
- Validación estricta de entradas (Zod), consultas SQL siempre parametrizadas y errores que no revelan detalles internos.
- Cabeceras seguras (Helmet), CORS con lista blanca, límite de solicitudes y tamaño de cuerpo.
- La API se conecta con una cuenta de **mínimo privilegio** (sin `DELETE`, sin permisos administrativos).
- Los secretos viven solo en archivos `.env`, que están en `.gitignore`. La aplicación no arranca si la configuración es incompleta o insegura.

---

## Primera Interfaz (Fase I)

El directorio `src/` contiene un **mockup interactivo** de la aplicación móvil, construido en HTML, CSS y JavaScript vanilla, sin dependencias externas más allá de la fuente tipográfica (IBM Plex Sans vía Google Fonts). Simula cinco pantallas navegables:

1. **Splash** — pantalla de carga con animación y auto-navegación al dashboard.
2. **Dashboard** — balance de ahorro, metas activas y últimos movimientos.
3. **Mis Metas** — listado de objetivos de ahorro con barras de progreso y estado.
4. **Aprende** — módulo de educación financiera con lección del día, categorías y logros.
5. **Perfil** — resumen de actividad y configuración de la cuenta.

Para visualizarlo, abra `src/templates/index.html` en cualquier navegador de escritorio.

---

## Documentación de la Fase II

La carpeta [`docs/`](docs/) contiene el documento de análisis y diseño (arquitectura de software, casos de uso, diagrama de clases, modelo relacional e integración de los modelos) y los diagramas en formato PNG.

---

## Créditos

| | |
|---|---|
| **Estudiante** | Katherin Johana Vallejo Bulla |
| **Programa** | Ingeniería de Software |
| **Semestre** | Sexto semestre |
| **Institución** | Universidad Manuela Beltrán, Bogotá |
| **Año** | 2026 |
| **Asignatura** | Sistemas Transaccionales |
