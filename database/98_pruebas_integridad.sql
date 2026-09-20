/* ============================================================================
   GKMF - Garantía de Conocimiento y Movilidad Financiera
   Script 98: Pruebas de las restricciones de integridad

   Objetivo : demostrar que el propio motor rechaza los datos inválidos
              (claves primarias y foráneas, UNIQUE y CHECK), sin depender del
              backend. Cada prueba intenta una operación INVÁLIDA y comprueba
              que falle con el error y la restricción esperados.
   Requiere : 01, 02 y 03 (usa los datos iniciales por su clave natural).
   Seguridad: cada prueba corre dentro de su propia transacción que siempre se
              revierte; la base de datos no queda modificada.
   Resultado: una fila por prueba (OK / FALLO). Termina con error si alguna
              falla, de modo que sqlcmd -b devuelva un código de salida != 0.
   ============================================================================ */

USE GKMF;
GO

SET NOCOUNT ON;
SET XACT_ABORT OFF;
GO

DECLARE @pruebas TABLE (
    n           INT IDENTITY(1,1) PRIMARY KEY,
    descripcion NVARCHAR(120)  NOT NULL,
    sentencia   NVARCHAR(MAX)  NOT NULL,
    error       INT            NOT NULL,   -- 547 = CHECK/FK, 2627 = PK/UNIQUE, 2601 = índice único
    restriccion NVARCHAR(60)   NULL        -- fragmento del nombre de la restricción esperada
);

DECLARE @k NVARCHAR(200) = N'(SELECT id_usuario FROM dbo.usuario WHERE correo = N''katherin.vallejo@example.com'')';
DECLARE @c NVARCHAR(200) = N'(SELECT id_usuario FROM dbo.usuario WHERE correo = N''carlos.rojas@example.com'')';
DECLARE @meta_k NVARCHAR(300) = N'(SELECT id_meta FROM dbo.meta_ahorro WHERE nombre = N''Mercado del mes'')';
DECLARE @cat_egreso NVARCHAR(300) = N'(SELECT TOP (1) id_categoria_movimiento FROM dbo.categoria_movimiento WHERE tipo = ''EGRESO'')';

INSERT @pruebas (descripcion, sentencia, error, restriccion) VALUES
-- ---------------------------------------------------------------- transaccion
(N'Transacción con monto negativo',
 N'INSERT dbo.transaccion (id_usuario, id_categoria_movimiento, tipo, monto, descripcion) VALUES (' + @k + N', ' + @cat_egreso + N', ''EGRESO'', -10, N''Prueba'');',
 547, N'CK_transaccion_monto_positivo'),
(N'Depósito sin meta asociada',
 N'INSERT dbo.transaccion (id_usuario, tipo, monto, descripcion) VALUES (' + @k + N', ''DEPOSITO_META'', 1000, N''Prueba'');',
 547, N'CK_transaccion_coherencia'),
(N'Egreso sin categoría',
 N'INSERT dbo.transaccion (id_usuario, tipo, monto, descripcion) VALUES (' + @k + N', ''EGRESO'', 1000, N''Prueba'');',
 547, N'CK_transaccion_coherencia'),
(N'Egreso asociado a una meta de ahorro',
 N'INSERT dbo.transaccion (id_usuario, id_meta, id_categoria_movimiento, tipo, monto, descripcion) VALUES (' + @k + N', ' + @meta_k + N', ' + @cat_egreso + N', ''EGRESO'', 1000, N''Prueba'');',
 547, N'CK_transaccion_coherencia'),
(N'Tipo de transacción inexistente',
 N'INSERT dbo.transaccion (id_usuario, id_categoria_movimiento, tipo, monto, descripcion) VALUES (' + @k + N', ' + @cat_egreso + N', ''TRANSFERENCIA'', 1000, N''Prueba'');',
 547, N'CK_transaccion_'),   -- incumple CK_transaccion_tipo y CK_transaccion_coherencia
(N'Transacción de un usuario inexistente (FK)',
 N'INSERT dbo.transaccion (id_usuario, id_categoria_movimiento, tipo, monto, descripcion) VALUES (-1, ' + @cat_egreso + N', ''EGRESO'', 1000, N''Prueba'');',
 547, N'FK_transaccion_usuario'),
(N'Depósito en la meta de OTRO usuario (FK compuesta)',
 N'INSERT dbo.transaccion (id_usuario, id_meta, tipo, monto, descripcion) VALUES (' + @c + N', ' + @meta_k + N', ''DEPOSITO_META'', 1000, N''Prueba'');',
 547, N'FK_transaccion_meta'),
(N'Transacción con código global repetido (idempotencia offline)',
 N'INSERT dbo.transaccion (id_usuario, id_categoria_movimiento, tipo, monto, descripcion, codigo_global) SELECT TOP (1) id_usuario, ' + @cat_egreso + N', ''EGRESO'', 1000, N''Prueba'', codigo_global FROM dbo.transaccion WHERE tipo = ''EGRESO'';',
 2627, N'UQ_transaccion_codigo_global'),
-- ---------------------------------------------------------------- meta_ahorro
(N'Meta con saldo ahorrado negativo',
 N'UPDATE dbo.meta_ahorro SET monto_ahorrado = -1 WHERE nombre = N''Mercado del mes'';',
 547, N'CK_meta_ahorro_ahorrado_no_negativo'),
(N'Meta con monto objetivo en cero',
 N'UPDATE dbo.meta_ahorro SET monto_objetivo = 0 WHERE nombre = N''Mercado del mes'';',
 547, N'CK_meta_ahorro_objetivo_positivo'),
(N'Meta con estado inexistente',
 N'UPDATE dbo.meta_ahorro SET estado = ''CERRADA'' WHERE nombre = N''Mercado del mes'';',
 547, N'CK_meta_ahorro_estado'),
(N'Meta marcada como completada sin alcanzar el objetivo',
 N'UPDATE dbo.meta_ahorro SET estado = ''COMPLETADA'' WHERE nombre = N''Mercado del mes'';',
 547, N'CK_meta_ahorro_completada'),
(N'Meta con fecha límite anterior a su creación',
 N'UPDATE dbo.meta_ahorro SET fecha_limite = ''2020-01-01'' WHERE nombre = N''Mercado del mes'';',
 547, N'CK_meta_ahorro_fecha_limite'),
-- ---------------------------------------------------------------- usuario
(N'Usuario con correo repetido (sin distinguir mayúsculas)',
 N'INSERT dbo.usuario (nombres, apellidos, correo, hash_contrasena) VALUES (N''Prueba'', N''Duplicado'', N''KATHERIN.VALLEJO@EXAMPLE.COM'', REPLICATE(''x'', 60));',
 2627, N'UQ_usuario_correo'),
(N'Usuario con correo de formato inválido',
 N'INSERT dbo.usuario (nombres, apellidos, correo, hash_contrasena) VALUES (N''Prueba'', N''Formato'', N''correo-sin-arroba'', REPLICATE(''x'', 60));',
 547, N'CK_usuario_correo_formato'),
(N'Contraseña en texto plano (hash demasiado corto)',
 N'INSERT dbo.usuario (nombres, apellidos, correo, hash_contrasena) VALUES (N''Prueba'', N''Clave'', N''prueba.clave@example.com'', ''Clave123'');',
 547, N'CK_usuario_hash_longitud'),
(N'Usuario con rol inexistente',
 N'INSERT dbo.usuario (nombres, apellidos, correo, hash_contrasena, rol) VALUES (N''Prueba'', N''Rol'', N''prueba.rol@example.com'', REPLICATE(''x'', 60), ''SUPERUSUARIO'');',
 547, N'CK_usuario_rol'),
(N'Eliminar un usuario que tiene metas y movimientos (FK)',
 N'DELETE FROM dbo.usuario WHERE correo = N''katherin.vallejo@example.com'';',
 547, NULL),
-- ---------------------------------------------------------------- sesion
(N'Sesión con hash de token no hexadecimal',
 N'INSERT dbo.sesion (id_usuario, hash_token_refresco, fecha_expiracion) VALUES (' + @k + N', REPLICATE(''Z'', 64), DATEADD(DAY, 1, SYSUTCDATETIME()));',
 547, N'CK_sesion_hash_hexadecimal'),
(N'Sesión que expira antes de crearse',
 N'INSERT dbo.sesion (id_usuario, hash_token_refresco, fecha_expiracion) VALUES (' + @k + N', REPLICATE(''a'', 64), DATEADD(DAY, -1, SYSUTCDATETIME()));',
 547, N'CK_sesion_expiracion'),
-- ---------------------------------------------------------------- sincronizacion
(N'Sincronización con más operaciones aplicadas que recibidas',
 N'INSERT dbo.sincronizacion (id_usuario, identificador_dispositivo, estado, fecha_fin, operaciones_recibidas, operaciones_aplicadas) VALUES (' + @k + N', N''dispositivo-prueba'', ''COMPLETADA'', SYSUTCDATETIME(), 1, 2);',
 547, N'CK_sincronizacion_operaciones'),
(N'Sincronización en curso con fecha de fin',
 N'INSERT dbo.sincronizacion (id_usuario, identificador_dispositivo, estado, fecha_fin) VALUES (' + @k + N', N''dispositivo-prueba'', ''EN_CURSO'', SYSUTCDATETIME());',
 547, N'CK_sincronizacion_fin'),
-- ---------------------------------------------------------------- educación
(N'Lección de una categoría inexistente (FK)',
 N'INSERT dbo.leccion (id_categoria_leccion, titulo, resumen, duracion_minutos) VALUES (-1, N''Prueba'', N''Prueba'', 5);',
 547, N'FK_leccion_categoria'),
(N'Lección con duración fuera de rango',
 N'UPDATE dbo.leccion SET duracion_minutos = 0 WHERE titulo = N''Hablar de dinero en familia'';',
 547, N'CK_leccion_duracion'),
(N'Segunda "Lección del día" a la vez (índice único filtrado)',
 N'UPDATE dbo.leccion SET es_destacada = 1 WHERE titulo = N''Hablar de dinero en familia'';',
 2601, N'UX_leccion_destacada'),
(N'Progreso completado sin fecha de finalización',
 N'INSERT dbo.progreso_leccion (id_usuario, id_leccion, porcentaje, completada) SELECT ' + @c + N', id_leccion, 100, 1 FROM dbo.leccion WHERE titulo = N''Hablar de dinero en familia'';',
 547, N'CK_progreso_leccion_completada'),
(N'Progreso mayor a 100 %',
 N'INSERT dbo.progreso_leccion (id_usuario, id_leccion, porcentaje) SELECT ' + @c + N', id_leccion, 150 FROM dbo.leccion WHERE titulo = N''Hablar de dinero en familia'';',
 547, N'CK_progreso_leccion_'),
(N'Progreso duplicado del mismo usuario y lección (PK compuesta)',
 N'INSERT dbo.progreso_leccion (id_usuario, id_leccion) SELECT TOP (1) id_usuario, id_leccion FROM dbo.progreso_leccion;',
 2627, N'PK_progreso_leccion'),
(N'Logro repetido para el mismo usuario (PK compuesta)',
 N'INSERT dbo.usuario_logro (id_usuario, id_logro) SELECT TOP (1) id_usuario, id_logro FROM dbo.usuario_logro;',
 2627, N'PK_usuario_logro');

DECLARE @resultados TABLE (
    n           INT,
    descripcion NVARCHAR(120),
    restriccion NVARCHAR(60),
    resultado   VARCHAR(5),
    detalle     NVARCHAR(400)
);

DECLARE @i INT = 1, @max INT = (SELECT MAX(n) FROM @pruebas);
DECLARE @sentencia NVARCHAR(MAX), @descripcion NVARCHAR(120), @error INT, @restriccion NVARCHAR(60);

WHILE @i <= @max
BEGIN
    SELECT @sentencia = sentencia, @descripcion = descripcion, @error = error, @restriccion = restriccion
      FROM @pruebas WHERE n = @i;

    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC sys.sp_executesql @sentencia;
        ROLLBACK TRANSACTION;
        INSERT @resultados VALUES (@i, @descripcion, @restriccion, 'FALLO', N'La operación inválida fue ACEPTADA por la base de datos.');
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        INSERT @resultados VALUES (
            @i, @descripcion, @restriccion,
            CASE WHEN ERROR_NUMBER() = @error
                  AND (@restriccion IS NULL OR ERROR_MESSAGE() LIKE N'%' + @restriccion + N'%')
                 THEN 'OK' ELSE 'FALLO' END,
            LEFT(CONCAT(N'Error ', ERROR_NUMBER(), N': ', ERROR_MESSAGE()), 400));
    END CATCH;

    SET @i += 1;
END;

SELECT n AS [#], resultado AS [Resultado], descripcion AS [Operación inválida intentada], restriccion AS [Restricción esperada]
  FROM @resultados ORDER BY n;

DECLARE @fallos INT = (SELECT COUNT(*) FROM @resultados WHERE resultado <> 'OK');
DECLARE @total  INT = (SELECT COUNT(*) FROM @resultados);
PRINT CONCAT(N'Pruebas de integridad: ', @total - @fallos, N' de ', @total, N' correctas.');

IF @fallos > 0
BEGIN
    SELECT n, descripcion, detalle FROM @resultados WHERE resultado <> 'OK' ORDER BY n;
    THROW 50003, N'Al menos una restricción de integridad no se comportó como se esperaba.', 1;
END;
GO
