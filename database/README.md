# database/

Scripts T-SQL de la base de datos **GKMF** para **Microsoft SQL Server 2019 o superior** (probados en SQL Server 2022). Implementan el modelo relacional definido en la documentación de la Fase II: 11 tablas, claves primarias y foráneas, restricciones de integridad, índices y datos de prueba.

## Scripts

Se ejecutan en orden numérico. Todos son **idempotentes** (se pueden volver a ejecutar sin duplicar ni romper nada), salvo el `90`, que es destructivo a propósito.

| Script | Propósito | ¿Obligatorio? |
|---|---|---|
| `01_crear_base_datos.sql` | Crea la base de datos `GKMF` con intercalación `Modern_Spanish_CI_AS` | Sí |
| `02_crear_tablas.sql` | Crea las 11 tablas con sus claves, restricciones (`PK_`, `FK_`, `UQ_`, `CK_`, `DF_`), índices y descripciones | Sí |
| `03_datos_iniciales.sql` | Carga datos de prueba (3 usuarios, 5 metas, 17 movimientos, 12 lecciones, 5 logros…) en una sola transacción | Sí, para pruebas |
| `04_seguridad_rol_api.sql` | Crea el rol `rol_api_gkmf` y la cuenta `gkmf_api` de **mínimo privilegio** para el backend | Recomendado |
| `90_eliminar_esquema.sql` | Elimina todas las tablas (reinicio del entorno). No hace nada hasta cambiar `@confirmar` a 1 | No |
| `98_pruebas_integridad.sql` | Intenta 29 operaciones inválidas y comprueba que el motor las rechace con la restricción esperada | No |
| `99_verificacion.sql` | Solo lectura: comprueba el esquema (11 tablas, 11 PK, 12 FK…), el invariante contable y muestra un panorama de datos | No |

## Cómo ejecutarlos

### Con SSMS (SQL Server Management Studio)

1. Conéctese a su instancia (por ejemplo `.\SQLEXPRESS`).
2. `Archivo → Abrir → Archivo…` y abra `01_crear_base_datos.sql`; presione **F5**.
3. Repita con `02_crear_tablas.sql` y `03_datos_iniciales.sql`.
4. Para `04_seguridad_rol_api.sql`: reemplace el marcador de la línea `DECLARE @clave` por una contraseña fuerte (mínimo 16 caracteres, sin comilla simple) y ejecute. **No suba ese cambio al repositorio.** El script se niega a correr mientras el marcador siga intacto.
5. Ejecute `99_verificacion.sql`: todas las comprobaciones deben salir `OK`.

> Los archivos están en UTF-8 con BOM para que SSMS interprete correctamente las tildes y la ñ.

### Con `sqlcmd`

```bash
sqlcmd -S .\SQLEXPRESS -E -f 65001 -b -I -i 01_crear_base_datos.sql
sqlcmd -S .\SQLEXPRESS -E -f 65001 -b -I -i 02_crear_tablas.sql
sqlcmd -S .\SQLEXPRESS -E -f 65001 -b -I -i 03_datos_iniciales.sql
sqlcmd -S .\SQLEXPRESS -E -f 65001 -b -I -i 99_verificacion.sql
```

`-I` activa `QUOTED_IDENTIFIER`, necesario para los índices filtrados; `-b` detiene la ejecución ante un error.

### Con Docker

Desde la raíz del repositorio, `docker compose up -d db db-init` levanta SQL Server y ejecuta los scripts 01, 02, 03, 04 y 99 automáticamente (ver el README raíz).

## Modelo de datos

| Tabla | Descripción |
|---|---|
| `usuario` | Persona registrada (ahorrador o administrador de contenido); baja lógica con `activo` |
| `sesion` | Sesión iniciada; guarda solo el hash SHA-256 del token de refresco |
| `meta_ahorro` | Objetivo de ahorro con saldo (nunca negativo), fecha límite y estado |
| `categoria_movimiento` | Catálogo de categorías de ingresos y egresos |
| `transaccion` | Libro mayor de movimientos: ingreso, egreso, depósito o retiro de una meta |
| `sincronizacion` | Sesión de sincronización de un dispositivo (modo sin conexión) |
| `categoria_leccion` | Temas de educación financiera |
| `leccion` | Lección corta; solo una puede ser la "lección del día" |
| `progreso_leccion` | Avance de un usuario en una lección (N:M) |
| `logro` | Catálogo de logros (insignias) |
| `usuario_logro` | Logro obtenido por un usuario (N:M) |

Puntos de diseño relevantes:

- **Claves foráneas compuestas** `(id_meta, id_usuario)` e `(id_sincronizacion, id_usuario)` en `transaccion`: la base de datos impide referenciar la meta o la sincronización de otro usuario.
- **`CK_transaccion_coherencia`:** los ingresos y egresos exigen categoría y no llevan meta; los depósitos y retiros exigen meta y no llevan categoría.
- **`codigo_global` (GUID)** en `meta_ahorro` y `transaccion`: permite crear registros sin conexión y aplicarlos una sola vez al sincronizar.
- **`version_fila` (`ROWVERSION`)** en `meta_ahorro`: control de concurrencia optimista.
- Fechas en **UTC** (`DATETIME2`), dinero en `DECIMAL(14,2)`, texto en `NVARCHAR`.

## Datos de prueba

Solo para desarrollo. Reproducen el prototipo de la Fase I: ahorro total de **$247.500**, tres metas activas (**$202.000**) y los últimos movimientos que muestra el Dashboard. Los correos usan el dominio reservado `example.com`.

Las cuentas de prueba **no tienen contraseña utilizable**: su `hash_contrasena` es un marcador. Las cuentas reales se crean con el registro del backend (Fase III), que guarda un hash con sal.

## Seguridad

`04_seguridad_rol_api.sql` implementa el principio de mínimo privilegio: el backend **no** se conecta como `sa` ni como `dbo`, sino como `gkmf_api`, que puede leer y escribir donde corresponde pero **no puede borrar filas** (`DENY DELETE`) ni **modificar el libro de movimientos** (`DENY UPDATE` sobre `transaccion`). La contraseña nunca está en el repositorio: se recibe por la variable `GKMF_API_PASSWORD` de `sqlcmd` o se escribe a mano en SSMS.
