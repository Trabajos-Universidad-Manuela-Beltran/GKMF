/* ============================================================================
   GKMF - Garantía de Conocimiento y Movilidad Financiera
   Script 03: Datos iniciales de prueba

   Motor    : Microsoft SQL Server 2019 o superior (probado en SQL Server 2022)
   Requiere : haber ejecutado 01_crear_base_datos.sql y 02_crear_tablas.sql
   Ejecutar : SSMS -> abrir este archivo -> F5
              o bien: sqlcmd -S <instancia> -E -f 65001 -b -I -i 03_datos_iniciales.sql
   Notas    : - Solo para DESARROLLO Y PRUEBAS. Los datos reproducen el
                prototipo de la Fase I (metas, movimientos, lecciones, logros).
              - Es atómico: se ejecuta dentro de una única transacción; si algo
                falla no queda ningún dato a medias.
              - Es idempotente y converge: cada catálogo (categorías, lecciones,
                logros) se carga solo si está vacío, y los datos de demostración
                (usuarios, metas, movimientos...) solo si no hay usuarios.
              - Cada inserción con búsqueda por nombre verifica cuántas filas
                insertó; si un nombre no coincide, el script falla con un error
                claro en lugar de omitir filas en silencio.
              - Las cuentas de prueba NO tienen contraseña utilizable: el valor de
                hash_contrasena es un marcador. Las cuentas reales se crean con
                el registro del backend (Fase III), que guarda un hash con sal.
              - Los correos usan el dominio reservado example.com (RFC 2606).
              - Fechas en UTC. Bogotá es UTC-5 (p. ej. 10:32 a. m. local = 15:32 UTC).
              - Invariante que se cumple en los datos:
                meta_ahorro.monto_ahorrado = depósitos - retiros de esa meta.
   ============================================================================ */

USE GKMF;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    /* ------------------------------------------------------------------------
       Catálogo: categorías de movimiento
       ------------------------------------------------------------------------ */
    IF NOT EXISTS (SELECT 1 FROM dbo.categoria_movimiento)
    BEGIN
        INSERT INTO dbo.categoria_movimiento (nombre, tipo, icono)
        VALUES
            (N'Alimentación',         'EGRESO',  'carrito'),
            (N'Transporte',           'EGRESO',  'bus'),
            (N'Servicios públicos',   'EGRESO',  'bombilla'),
            (N'Educación',            'EGRESO',  'libro'),
            (N'Salud',                'EGRESO',  'corazon'),
            (N'Otros gastos',         'EGRESO',  'etiqueta'),
            (N'Salario o jornal',     'INGRESO', 'billete'),
            (N'Ingreso independiente','INGRESO', 'maletin'),
            (N'Otros ingresos',       'INGRESO', 'etiqueta');
        IF @@ROWCOUNT <> 9
            THROW 50011, N'La carga del catálogo categoria_movimiento no insertó las 9 filas esperadas.', 1;
    END;


    /* ------------------------------------------------------------------------
       Catálogo: categorías de lección, lecciones y logros
       ------------------------------------------------------------------------ */
    IF NOT EXISTS (SELECT 1 FROM dbo.categoria_leccion)
    BEGIN
        INSERT INTO dbo.categoria_leccion (nombre, descripcion, icono)
        VALUES
            (N'Ahorro',       N'Hábitos y estrategias para ahorrar de forma constante.',            'candado'),
            (N'Crédito',      N'Cómo funcionan los créditos, sus costos y sus riesgos.',            'tarjeta'),
            (N'Presupuesto',  N'Organización de ingresos y gastos del hogar.',                      'grafico'),
            (N'Protección',   N'Seguros y seguridad para proteger el dinero y los datos.',          'escudo'),
            (N'Inversión',    N'Conceptos básicos para empezar a invertir con pequeños montos.',    'tendencia'),
            (N'Familia',      N'Finanzas compartidas y educación financiera en el hogar.',          'familia');
        IF @@ROWCOUNT <> 6
            THROW 50012, N'La carga del catálogo categoria_leccion no insertó las 6 filas esperadas.', 1;
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.leccion)
    BEGIN
        INSERT INTO dbo.leccion (id_categoria_leccion, titulo, resumen, contenido, duracion_minutos, orden, es_destacada)
        SELECT c.id_categoria_leccion, v.titulo, v.resumen, v.contenido, v.duracion, v.orden, v.destacada
        FROM (VALUES
            (N'Ahorro',      N'¿Qué es el ahorro programado?',
                N'Aprende a separar dinero automáticamente cada vez que recibes ingresos.',
                N'El ahorro programado consiste en apartar un valor fijo o un porcentaje de cada ingreso antes de gastarlo. Al hacerlo de forma periódica, el hábito se vuelve automático y el dinero se acumula sin depender de la fuerza de voluntad.',
                5, 1, 1),
            (N'Ahorro',      N'Cómo fijar tu primera meta de ahorro',
                N'Define un objetivo claro, un monto y una fecha para empezar a ahorrar con propósito.',
                N'Una meta útil es específica, medible y tiene fecha límite. Divide el monto total entre las semanas disponibles para saber cuánto debes abonar en cada periodo.',
                6, 2, 0),
            (N'Crédito',     N'¿Qué es un crédito y cuánto cuesta realmente?',
                N'Conoce la tasa de interés, las cuotas y el costo total antes de endeudarte.',
                N'Todo crédito tiene un costo que se expresa en la tasa de interés y en cobros adicionales. Antes de aceptarlo, compara el valor total a pagar y no solo la cuota mensual.',
                7, 1, 0),
            (N'Crédito',     N'Cómo evitar el sobreendeudamiento',
                N'Identifica señales de alerta y aprende a mantener tus deudas bajo control.',
                N'Una regla práctica es que las cuotas de todas tus deudas no superen un tercio de tus ingresos. Prioriza pagar primero las deudas con mayor tasa de interés.',
                8, 2, 0),
            (N'Presupuesto', N'¿Cómo hacer un presupuesto familiar?',
                N'Organiza tus ingresos y gastos del mes para saber a dónde va tu dinero.',
                N'El presupuesto familiar lista los ingresos esperados y los gastos fijos y variables del mes. La diferencia entre ambos indica cuánto puedes destinar al ahorro.',
                8, 1, 0),
            (N'Presupuesto', N'Los 3 errores más comunes con el dinero',
                N'Reconoce los hábitos que más afectan tus finanzas y cómo corregirlos.',
                N'Los errores más frecuentes son no llevar registro de los gastos, gastar antes de ahorrar y usar deuda para gastos cotidianos. Corregirlos empieza por anotar cada movimiento.',
                5, 2, 0),
            (N'Protección',  N'Seguros y microseguros: ¿cuándo vale la pena?',
                N'Entiende cómo un seguro protege tu patrimonio frente a imprevistos.',
                N'Un seguro transfiere a una aseguradora el riesgo de una pérdida a cambio de una prima. Los microseguros ofrecen coberturas básicas con primas bajas para población de menores ingresos.',
                6, 1, 0),
            (N'Protección',  N'Cómo proteger tus datos y tu dinero de fraudes',
                N'Buenas prácticas para evitar estafas y suplantación de identidad.',
                N'Nunca compartas claves ni códigos de verificación y desconfía de mensajes que exijan actuar con urgencia. Verifica siempre por los canales oficiales de tu entidad.',
                7, 2, 0),
            (N'Inversión',   N'Primeros pasos en la inversión básica',
                N'Conoce qué significa invertir y qué alternativas existen para pequeños montos.',
                N'Invertir es destinar dinero a un activo esperando un rendimiento futuro. Antes de hacerlo conviene contar con un fondo de emergencia y entender el plazo y el riesgo de cada alternativa.',
                9, 1, 0),
            (N'Inversión',   N'Riesgo y rentabilidad: la relación clave',
                N'Comprende por qué una mayor rentabilidad esperada implica mayor riesgo.',
                N'En general, a mayor rentabilidad esperada mayor es la posibilidad de pérdida. Diversificar y definir el plazo de la inversión ayuda a gestionar ese riesgo.',
                8, 2, 0),
            (N'Familia',     N'Hablar de dinero en familia',
                N'Estrategias para acordar metas y gastos compartidos sin conflictos.',
                N'Fijar reuniones periódicas para revisar ingresos, gastos y metas comunes evita malentendidos. Cada integrante debe conocer su aporte y sus prioridades.',
                5, 1, 0),
            (N'Familia',     N'Enseñar a los niños a ahorrar',
                N'Actividades sencillas para formar hábitos de ahorro desde temprana edad.',
                N'Una alcancía con una meta visible, como comprar un juguete, ayuda a los niños a asociar el ahorro con un objetivo concreto. Los adultos refuerzan el hábito con el ejemplo.',
                6, 2, 0)
        ) AS v (categoria, titulo, resumen, contenido, duracion, orden, destacada)
        JOIN dbo.categoria_leccion AS c ON c.nombre = v.categoria;
        IF @@ROWCOUNT <> 12
            THROW 50013, N'La carga del catálogo leccion no insertó las 12 filas esperadas.', 1;
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.logro)
    BEGIN
        INSERT INTO dbo.logro (codigo, nombre, descripcion, icono)
        VALUES
            ('PRIMERA_META',   N'Primera meta',   N'Se otorga al crear la primera meta de ahorro.',                          'objetivo'),
            ('TRES_LECCIONES', N'3 lecciones',    N'Se otorga al completar tres lecciones de educación financiera.',         'libro'),
            ('SIETE_DIAS',     N'7 días activa',  N'Se otorga al registrar actividad durante siete días consecutivos.',      'estrella'),
            ('META_CUMPLIDA',  N'Meta cumplida',  N'Se otorga al alcanzar el monto objetivo de una meta de ahorro.',         'trofeo'),
            ('CONSTANCIA',     N'Constancia',     N'Se otorga al realizar aportes a metas durante cuatro semanas seguidas.', 'rayo');
        IF @@ROWCOUNT <> 5
            THROW 50014, N'La carga del catálogo logro no insertó las 5 filas esperadas.', 1;
    END;


    /* ------------------------------------------------------------------------
       Datos de demostración (solo si aún no hay usuarios)
       ------------------------------------------------------------------------ */
    IF NOT EXISTS (SELECT 1 FROM dbo.usuario)
    BEGIN
        /* ------------------------------------------------------------------------
           Usuarios (2 ahorradores y 1 administrador de contenido)
           ------------------------------------------------------------------------ */
        DECLARE @marcador_hash VARCHAR(255) = '!SIN_CLAVE_DEFINIDA!ESTABLECER_DESDE_EL_BACKEND_EN_LA_FASE_III';

        INSERT INTO dbo.usuario (nombres, apellidos, correo, hash_contrasena, rol, fecha_registro, ultimo_acceso)
        VALUES
            (N'Katherin Johana',  N'Vallejo Bulla',  N'katherin.vallejo@example.com', @marcador_hash, 'USUARIO',       '2026-09-01T13:00:00', '2026-09-20T13:00:00'),
            (N'Carlos Andrés',    N'Rojas Pineda',   N'carlos.rojas@example.com',     @marcador_hash, 'USUARIO',       '2026-09-05T15:30:00', '2026-09-18T22:10:00'),
            (N'Administrador',    N'Contenido GKMF', N'admin.contenido@example.com',  @marcador_hash, 'ADMINISTRADOR', '2026-08-15T12:00:00', '2026-09-19T14:00:00');

        DECLARE @id_katherin INT = (SELECT id_usuario FROM dbo.usuario WHERE correo = N'katherin.vallejo@example.com');
        DECLARE @id_carlos   INT = (SELECT id_usuario FROM dbo.usuario WHERE correo = N'carlos.rojas@example.com');

        /* ------------------------------------------------------------------------
           Metas de ahorro. Se insertan con saldo 0 y se ajustan al final con la
           suma de sus movimientos (así los datos cumplen el invariante contable).
           Total ahorrado por Katherin: 72.000 + 85.000 + 45.000 + 45.500 = 247.500
           ------------------------------------------------------------------------ */
        INSERT INTO dbo.meta_ahorro
            (id_usuario, nombre, descripcion, icono, monto_objetivo, fecha_limite, estado, fecha_creacion, fecha_actualizacion)
        VALUES
            (@id_katherin, N'Mercado del mes',      N'Alimentación familiar mensual',  'carrito', 100000, '2026-10-30', 'EN_PROGRESO', '2026-09-01T13:00:00', '2026-09-01T13:00:00'),
            (@id_katherin, N'Útiles del colegio',   N'Materiales para el semestre',    'libro',   200000, '2026-12-15', 'EN_PROGRESO', '2026-08-15T14:00:00', '2026-08-15T14:00:00'),
            (@id_katherin, N'Fondo de emergencia',  N'Reserva para imprevistos',       'escudo',  250000, '2027-03-31', 'ATRASADA',    '2026-08-01T14:00:00', '2026-08-01T14:00:00'),
            (@id_katherin, N'Regalo de cumpleaños', N'Regalo para un familiar',        'regalo',  120000, '2026-11-20', 'PAUSADA',     '2026-07-10T14:00:00', '2026-07-10T14:00:00'),
            (@id_carlos,   N'Bicicleta',            N'Medio de transporte al trabajo', 'bicicleta', 350000, '2027-01-31', 'EN_PROGRESO', '2026-09-06T15:00:00', '2026-09-06T15:00:00');

        /* ------------------------------------------------------------------------
           Sincronizaciones (modo sin conexión de Katherin). La primera falló por
           conexión inestable; la segunda aplicó las 2 operaciones acumuladas.
           ------------------------------------------------------------------------ */
        INSERT INTO dbo.sincronizacion
            (id_usuario, identificador_dispositivo, fecha_inicio, fecha_fin, estado, operaciones_recibidas, operaciones_aplicadas, detalle_error)
        VALUES
            (@id_katherin, N'android-kv-01', '2026-09-20T01:20:00', '2026-09-20T01:20:30', 'FALLIDA',    2, 0, N'Tiempo de espera agotado: la conexión se interrumpió durante el envío.'),
            (@id_katherin, N'android-kv-01', '2026-09-20T13:00:00', '2026-09-20T13:00:04', 'COMPLETADA', 2, 2, NULL);

        DECLARE @id_sync_ok BIGINT = (SELECT id_sincronizacion FROM dbo.sincronizacion WHERE id_usuario = @id_katherin AND estado = 'COMPLETADA');

        /* ------------------------------------------------------------------------
           Transacciones. Movimientos de meta: se resuelve la meta por nombre.
           ------------------------------------------------------------------------ */
        -- Depósitos y retiros de metas de Katherin
        INSERT INTO dbo.transaccion (id_usuario, id_meta, id_sincronizacion, tipo, monto, descripcion, fecha_movimiento, fecha_registro)
        SELECT @id_katherin, m.id_meta, v.id_sync, v.tipo, v.monto, v.descripcion, v.fecha, v.fecha_registro
        FROM (VALUES
            (N'Mercado del mes',      NULL,        'DEPOSITO_META', 30000, N'Abono a meta Mercado',      CAST('2026-09-05T14:05:00' AS DATETIME2(0)), CAST('2026-09-05T14:05:00' AS DATETIME2(0))),
            (N'Mercado del mes',      NULL,        'DEPOSITO_META', 22000, N'Abono a meta Mercado',      CAST('2026-09-12T13:40:00' AS DATETIME2(0)), CAST('2026-09-12T13:40:00' AS DATETIME2(0))),
            (N'Mercado del mes',      @id_sync_ok, 'DEPOSITO_META', 20000, N'Abono a meta Mercado',      CAST('2026-09-20T01:15:00' AS DATETIME2(0)), CAST('2026-09-20T13:00:03' AS DATETIME2(0))),
            (N'Útiles del colegio',   NULL,        'DEPOSITO_META', 50000, N'Abono a meta Útiles',       CAST('2026-08-28T15:00:00' AS DATETIME2(0)), CAST('2026-08-28T15:00:00' AS DATETIME2(0))),
            (N'Útiles del colegio',   NULL,        'DEPOSITO_META', 40000, N'Abono a meta Útiles',       CAST('2026-09-10T16:20:00' AS DATETIME2(0)), CAST('2026-09-10T16:20:00' AS DATETIME2(0))),
            (N'Útiles del colegio',   NULL,        'RETIRO_META',    5000, N'Retiro para fotocopias',    CAST('2026-09-14T17:00:00' AS DATETIME2(0)), CAST('2026-09-14T17:00:00' AS DATETIME2(0))),
            (N'Fondo de emergencia',  NULL,        'DEPOSITO_META', 25000, N'Abono a fondo de emergencia', CAST('2026-08-20T14:30:00' AS DATETIME2(0)), CAST('2026-08-20T14:30:00' AS DATETIME2(0))),
            (N'Fondo de emergencia',  NULL,        'DEPOSITO_META', 20000, N'Abono a fondo de emergencia', CAST('2026-09-02T14:10:00' AS DATETIME2(0)), CAST('2026-09-02T14:10:00' AS DATETIME2(0))),
            (N'Regalo de cumpleaños', NULL,        'DEPOSITO_META', 20000, N'Abono a regalo de cumpleaños', CAST('2026-07-18T15:00:00' AS DATETIME2(0)), CAST('2026-07-18T15:00:00' AS DATETIME2(0))),
            (N'Regalo de cumpleaños', NULL,        'DEPOSITO_META', 25500, N'Abono a regalo de cumpleaños', CAST('2026-08-02T15:00:00' AS DATETIME2(0)), CAST('2026-08-02T15:00:00' AS DATETIME2(0)))
        ) AS v (meta, id_sync, tipo, monto, descripcion, fecha, fecha_registro)
        JOIN dbo.meta_ahorro AS m ON m.id_usuario = @id_katherin AND m.nombre = v.meta;
        IF @@ROWCOUNT <> 10
            THROW 50020, N'No se insertaron los 10 movimientos de metas de Katherin (revise los nombres de las metas).', 1;

        -- Depósito de Carlos
        INSERT INTO dbo.transaccion (id_usuario, id_meta, tipo, monto, descripcion, fecha_movimiento, fecha_registro)
        SELECT @id_carlos, m.id_meta, 'DEPOSITO_META', 60000, N'Primer abono a la bicicleta', '2026-09-10T20:00:00', '2026-09-10T20:00:00'
        FROM dbo.meta_ahorro AS m
        WHERE m.id_usuario = @id_carlos AND m.nombre = N'Bicicleta';
        IF @@ROWCOUNT <> 1
            THROW 50021, N'No se insertó el depósito de Carlos.', 1;

        -- Ingresos y egresos (con categoría)
        INSERT INTO dbo.transaccion (id_usuario, id_categoria_movimiento, id_sincronizacion, tipo, monto, descripcion, fecha_movimiento, fecha_registro)
        SELECT v.id_usuario, c.id_categoria_movimiento, v.id_sync, v.tipo, v.monto, v.descripcion, v.fecha, v.fecha_registro
        FROM (VALUES
            (@id_katherin, N'Ingreso independiente', NULL,        'INGRESO', 180000, N'Pago por trabajo independiente', CAST('2026-09-01T13:00:00' AS DATETIME2(0)), CAST('2026-09-01T13:00:00' AS DATETIME2(0))),
            (@id_katherin, N'Servicios públicos',    NULL,        'EGRESO',   68000, N'Servicio de energía',            CAST('2026-09-08T14:00:00' AS DATETIME2(0)), CAST('2026-09-08T14:00:00' AS DATETIME2(0))),
            (@id_katherin, N'Alimentación',          NULL,        'EGRESO',   12000, N'Almuerzo',                        CAST('2026-09-15T17:30:00' AS DATETIME2(0)), CAST('2026-09-15T17:30:00' AS DATETIME2(0))),
            (@id_katherin, N'Transporte',            @id_sync_ok, 'EGRESO',    2950, N'Bus SITP',                        CAST('2026-09-19T12:50:00' AS DATETIME2(0)), CAST('2026-09-20T13:00:03' AS DATETIME2(0))),
            (@id_katherin, N'Alimentación',          NULL,        'EGRESO',   47000, N'Mercado La Esperanza',            CAST('2026-09-20T15:32:00' AS DATETIME2(0)), CAST('2026-09-20T15:32:00' AS DATETIME2(0))),
            (@id_carlos,   N'Transporte',            NULL,        'EGRESO',   15000, N'Recarga de transporte',           CAST('2026-09-12T11:00:00' AS DATETIME2(0)), CAST('2026-09-12T11:00:00' AS DATETIME2(0)))
        ) AS v (id_usuario, categoria, id_sync, tipo, monto, descripcion, fecha, fecha_registro)
        JOIN dbo.categoria_movimiento AS c ON c.nombre = v.categoria;
        IF @@ROWCOUNT <> 6
            THROW 50022, N'No se insertaron los 6 ingresos y egresos (revise los nombres de las categorías).', 1;

        -- Saldo de cada meta = depósitos - retiros (invariante contable)
        UPDATE m
           SET monto_ahorrado = s.saldo
          FROM dbo.meta_ahorro AS m
          JOIN (SELECT id_meta,
                       SUM(CASE tipo WHEN 'DEPOSITO_META' THEN monto ELSE -monto END) AS saldo
                  FROM dbo.transaccion
                 WHERE id_meta IS NOT NULL
                 GROUP BY id_meta) AS s ON s.id_meta = m.id_meta;
        IF @@ROWCOUNT <> 5
            THROW 50023, N'No se actualizó el saldo de las 5 metas.', 1;

        /* ------------------------------------------------------------------------
           Progreso de lecciones (Katherin): 7 completadas y 1 al 60 %
           ------------------------------------------------------------------------ */
        INSERT INTO dbo.progreso_leccion
            (id_usuario, id_leccion, porcentaje, completada, fecha_inicio, fecha_ultima_actividad, fecha_completado)
        SELECT @id_katherin, l.id_leccion, v.porcentaje, v.completada, v.inicio, v.ultima, v.completado
        FROM (VALUES
            (N'Cómo fijar tu primera meta de ahorro',           100, 1, CAST('2026-08-20T13:00:00' AS DATETIME2(0)), CAST('2026-08-20T13:06:00' AS DATETIME2(0)), CAST('2026-08-20T13:06:00' AS DATETIME2(0))),
            (N'Los 3 errores más comunes con el dinero',        100, 1, CAST('2026-08-24T13:00:00' AS DATETIME2(0)), CAST('2026-08-24T13:05:00' AS DATETIME2(0)), CAST('2026-08-24T13:05:00' AS DATETIME2(0))),
            (N'¿Qué es un crédito y cuánto cuesta realmente?',  100, 1, CAST('2026-08-25T13:00:00' AS DATETIME2(0)), CAST('2026-08-25T13:07:00' AS DATETIME2(0)), CAST('2026-08-25T13:07:00' AS DATETIME2(0))),
            (N'Cómo evitar el sobreendeudamiento',              100, 1, CAST('2026-09-02T13:00:00' AS DATETIME2(0)), CAST('2026-09-02T13:08:00' AS DATETIME2(0)), CAST('2026-09-02T13:08:00' AS DATETIME2(0))),
            (N'Hablar de dinero en familia',                    100, 1, CAST('2026-09-06T13:00:00' AS DATETIME2(0)), CAST('2026-09-06T13:05:00' AS DATETIME2(0)), CAST('2026-09-06T13:05:00' AS DATETIME2(0))),
            (N'Seguros y microseguros: ¿cuándo vale la pena?',  100, 1, CAST('2026-09-11T13:00:00' AS DATETIME2(0)), CAST('2026-09-11T13:06:00' AS DATETIME2(0)), CAST('2026-09-11T13:06:00' AS DATETIME2(0))),
            (N'Primeros pasos en la inversión básica',          100, 1, CAST('2026-09-16T13:00:00' AS DATETIME2(0)), CAST('2026-09-16T13:09:00' AS DATETIME2(0)), CAST('2026-09-16T13:09:00' AS DATETIME2(0))),
            (N'¿Cómo hacer un presupuesto familiar?',            60, 0, CAST('2026-09-19T13:00:00' AS DATETIME2(0)), CAST('2026-09-19T13:05:00' AS DATETIME2(0)), CAST(NULL AS DATETIME2(0)))
        ) AS v (titulo, porcentaje, completada, inicio, ultima, completado)
        JOIN dbo.leccion AS l ON l.titulo = v.titulo;
        IF @@ROWCOUNT <> 8
            THROW 50024, N'No se insertó el progreso de las 8 lecciones (revise los títulos).', 1;

        /* ------------------------------------------------------------------------
           Logros obtenidos: Katherin 3 (los demás aparecen bloqueados), Carlos 1
           ------------------------------------------------------------------------ */
        INSERT INTO dbo.usuario_logro (id_usuario, id_logro, fecha_obtencion)
        SELECT v.id_usuario, g.id_logro, v.fecha
        FROM (VALUES
            (@id_katherin, 'PRIMERA_META',   CAST('2026-08-01T14:00:00' AS DATETIME2(0))),
            (@id_katherin, 'TRES_LECCIONES', CAST('2026-08-25T13:07:00' AS DATETIME2(0))),
            (@id_katherin, 'SIETE_DIAS',     CAST('2026-09-10T13:00:00' AS DATETIME2(0))),
            (@id_carlos,   'PRIMERA_META',   CAST('2026-09-06T15:00:00' AS DATETIME2(0)))
        ) AS v (id_usuario, codigo, fecha)
        JOIN dbo.logro AS g ON g.codigo = v.codigo;
        IF @@ROWCOUNT <> 4
            THROW 50025, N'No se insertaron los 4 logros obtenidos.', 1;
    END;

    COMMIT TRANSACTION;
    PRINT N'Datos iniciales verificados: catálogos y datos de demostración presentes.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT N'Error al cargar los datos iniciales; se revirtió toda la transacción.';
    THROW;
END CATCH;
GO

