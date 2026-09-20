/* ============================================================================
   GKMF - Garantía de Conocimiento y Movilidad Financiera
   Script 99: Verificación del esquema y de los datos (solo lectura)

   Objetivo : comprobar que el esquema coincide con el modelo relacional
              documentado (11 tablas, 11 PK, 12 FK) y que los datos cumplen el
              invariante contable. No modifica nada.
   Requiere : 01, 02 y 03.
   Ejecutar : SSMS -> abrir este archivo -> F5
              o bien: sqlcmd -S <instancia> -E -f 65001 -b -I -i 99_verificacion.sql
   Resultado: 1) comprobaciones OK/FALLO, 2) filas por tabla, 3) panorama de
              datos de Katherin (equivalente a las pantallas del prototipo).
              Termina con error si alguna comprobación falla.
   ============================================================================ */

USE GKMF;
GO

SET NOCOUNT ON;
GO

/* ---------------------------------------------------------------------------
   1. Comprobaciones estructurales y de integridad de los datos
   --------------------------------------------------------------------------- */
DECLARE @c TABLE (n INT IDENTITY(1,1), comprobacion NVARCHAR(110), esperado INT, obtenido INT);

INSERT @c (comprobacion, esperado, obtenido) VALUES
(N'Tablas del esquema dbo',
    11, (SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped = 0)),
(N'Claves primarias',
    11, (SELECT COUNT(*) FROM sys.key_constraints WHERE type = 'PK')),
(N'Claves foráneas',
    12, (SELECT COUNT(*) FROM sys.foreign_keys)),
(N'Claves foráneas compuestas (id_meta / id_sincronizacion + id_usuario)',
     2, (SELECT COUNT(*) FROM (SELECT constraint_object_id FROM sys.foreign_key_columns
                                GROUP BY constraint_object_id HAVING COUNT(*) > 1) AS x)),
(N'Restricciones UNIQUE',
    11, (SELECT COUNT(*) FROM sys.key_constraints WHERE type = 'UQ')),
(N'Restricciones CHECK',
    23, (SELECT COUNT(*) FROM sys.check_constraints)),
(N'Restricciones sin nombre explícito (deben ser 0)',
     0, (SELECT COUNT(*) FROM (SELECT is_system_named FROM sys.key_constraints
                                UNION ALL SELECT is_system_named FROM sys.foreign_keys
                                UNION ALL SELECT is_system_named FROM sys.check_constraints
                                UNION ALL SELECT is_system_named FROM sys.default_constraints) AS x
          WHERE x.is_system_named = 1)),
(N'Metas cuyo saldo NO coincide con depósitos - retiros (invariante contable)',
     0, (SELECT COUNT(*) FROM dbo.meta_ahorro AS m
          WHERE m.monto_ahorrado <> ISNULL((SELECT SUM(CASE t.tipo WHEN 'DEPOSITO_META' THEN t.monto ELSE -t.monto END)
                                              FROM dbo.transaccion AS t WHERE t.id_meta = m.id_meta), 0))),
(N'Movimientos de meta cuyo usuario difiere del dueño de la meta',
     0, (SELECT COUNT(*) FROM dbo.transaccion AS t JOIN dbo.meta_ahorro AS m ON m.id_meta = t.id_meta
          WHERE t.id_usuario <> m.id_usuario)),
(N'Metas con saldo negativo',
     0, (SELECT COUNT(*) FROM dbo.meta_ahorro WHERE monto_ahorrado < 0)),
(N'Exceso de lecciones marcadas como "Lección del día" (máximo 1; debe ser 0)',
     0, (SELECT CASE WHEN COUNT(*) > 1 THEN COUNT(*) - 1 ELSE 0 END FROM dbo.leccion WHERE es_destacada = 1)),
(N'Usuarios con contraseña en texto plano (hash < 32 caracteres)',
     0, (SELECT COUNT(*) FROM dbo.usuario WHERE LEN(hash_contrasena) < 32));

SELECT n AS [#],
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLO' END AS [Resultado],
       comprobacion AS [Comprobación], esperado AS [Esperado], obtenido AS [Obtenido]
  FROM @c ORDER BY n;

IF EXISTS (SELECT 1 FROM @c WHERE esperado <> obtenido)
    THROW 50004, N'Verificación fallida: revise las comprobaciones marcadas como FALLO.', 1;
GO

/* ---------------------------------------------------------------------------
   2. Filas por tabla
   --------------------------------------------------------------------------- */
SELECT t.name AS [Tabla], SUM(p.rows) AS [Filas]
  FROM sys.tables AS t
  JOIN sys.partitions AS p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
 WHERE t.is_ms_shipped = 0
 GROUP BY t.name
 ORDER BY t.name;
GO

/* ---------------------------------------------------------------------------
   3. Panorama de Katherin (equivale a las pantallas del prototipo de la Fase I)
   --------------------------------------------------------------------------- */
DECLARE @id_usuario INT = (SELECT id_usuario FROM dbo.usuario WHERE correo = N'katherin.vallejo@example.com');

-- Dashboard: ahorro total, metas activas y lecciones completadas
SELECT (SELECT SUM(monto_ahorrado) FROM dbo.meta_ahorro WHERE id_usuario = @id_usuario)                                   AS [Ahorro total acumulado],
       (SELECT COUNT(*) FROM dbo.meta_ahorro WHERE id_usuario = @id_usuario AND estado IN ('EN_PROGRESO','ATRASADA'))     AS [Metas activas],
       (SELECT COUNT(*) FROM dbo.progreso_leccion WHERE id_usuario = @id_usuario AND completada = 1)                      AS [Lecciones completadas];

-- Mis Metas: progreso por meta
SELECT nombre AS [Meta], estado AS [Estado], monto_ahorrado AS [Ahorrado], monto_objetivo AS [Objetivo],
       CAST(100.0 * monto_ahorrado / monto_objetivo AS DECIMAL(5,1)) AS [% completado], fecha_limite AS [Fecha límite]
  FROM dbo.meta_ahorro WHERE id_usuario = @id_usuario ORDER BY id_meta;

-- Últimos movimientos
SELECT TOP (5) t.fecha_movimiento AS [Fecha (UTC)], t.tipo AS [Tipo], t.descripcion AS [Descripción], t.monto AS [Monto]
  FROM dbo.transaccion AS t WHERE t.id_usuario = @id_usuario ORDER BY t.fecha_movimiento DESC;

-- Aprende: lecciones por categoría
SELECT c.nombre AS [Categoría], COUNT(l.id_leccion) AS [Lecciones]
  FROM dbo.categoria_leccion AS c LEFT JOIN dbo.leccion AS l ON l.id_categoria_leccion = c.id_categoria_leccion
 GROUP BY c.nombre ORDER BY c.nombre;
GO
