# GKMF — Garantía de Conocimiento y Movilidad Financiera

**Estado:** `En desarrollo` | **Versión:** `0.1.0` | **Plataforma:** Móvil (Android / iOS)

---

## Descripción

GKMF es una aplicación móvil orientada a la **inclusión financiera en Colombia**. Su propósito es acompañar a personas con acceso limitado al sistema financiero formal para que puedan registrar sus ingresos y gastos, establecer metas de ahorro, acceder a educación financiera básica y operar desde zonas con conectividad reducida gracias a su modo offline.

El diseño del sistema está guiado por los **principios ACID** para garantizar la integridad de cada transacción registrada, y sigue una arquitectura orientada a la simplicidad y la confianza del usuario final.

---

## Módulos del sistema

| Módulo | Descripción |
|---|---|
| **Metas de Ahorro** | Creación, seguimiento y cierre de objetivos de ahorro con montos y fechas límite |
| **Registro de Transacciones** | Captura de ingresos y egresos categorizados con soporte offline |
| **Educación Financiera** | Lecciones cortas sobre ahorro, presupuesto, crédito e inversión básica |
| **Modo Offline** | Sincronización diferida; el usuario puede registrar datos sin conexión |

---

## Principios ACID aplicados

- **Atomicidad:** cada transacción se registra completa o no se registra; no existen estados intermedios persistidos.
- **Consistencia:** las reglas de negocio (saldo nunca negativo, metas con monto válido) se validan antes de confirmar cualquier escritura.
- **Aislamiento:** las operaciones concurrentes (sincronización offline + escritura local) no producen lecturas sucias ni conflictos silenciosos.
- **Durabilidad:** una vez confirmado un registro, persiste aunque la aplicación se cierre o el dispositivo pierda energía.

---

## Stack tecnológico planeado

| Capa | Tecnología |
|---|---|
| Interfaz móvil | React Native o Flutter |
| Base de datos local | SQLite (modo offline) |
| Backend y sincronización | Firebase Firestore + Firebase Auth |
| Notificaciones | Firebase Cloud Messaging |
| Prototipo / mockup | HTML5 + CSS3 + JavaScript vanilla |

---

## Estructura del proyecto

```
GKMF-Garant-a-de-Conocimiento-y-Movilidad-Financiera/
├── README.md
├── LICENSE
└── src/
    └── index.html          # Mockup interactivo de la primera interfaz
```

---

## Primera Interfaz

El archivo `src/index.html` contiene un **mockup interactivo autocontenido** de la aplicación móvil. Está construido en HTML, CSS y JavaScript vanilla puro, sin dependencias externas más allá de la fuente tipográfica (IBM Plex Sans via Google Fonts).

El mockup simula cuatro pantallas navegables:

1. **Splash** — pantalla de carga con animación y auto-navegación al dashboard.
2. **Dashboard** — vista principal con balance de ahorro, metas activas y últimos movimientos.
3. **Mis Metas** — listado de objetivos de ahorro con barras de progreso y estado.
4. **Aprende** — módulo de educación financiera con lección del día, categorías y logros.

Para visualizarlo, abrir `src/index.html` directamente en cualquier navegador de escritorio.

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
