/* ============================================================================
   GKMF - Garantía de Conocimiento y Movilidad Financiera
   Script 02: Tablas, claves primarias y foráneas, restricciones e índices

   Motor    : Microsoft SQL Server 2019 o superior (probado en SQL Server 2022)
   Requiere : haber ejecutado 01_crear_base_datos.sql
   Ejecutar : SSMS -> abrir este archivo -> F5
              o bien: sqlcmd -S <instancia> -E -f 65001 -b -I -i 02_crear_tablas.sql
   Notas    : - Es idempotente y NO destructivo: cada tabla se crea solo si no
                existe. Para reiniciar el esquema use 90_eliminar_esquema.sql.
              - Corresponde 1 a 1 con el modelo relacional de la documentación
                de la Fase II (sección 7): 11 tablas.
              - Convención: snake_case en español, nombres de tabla en singular;
                restricciones nombradas (PK_, FK_, UQ_, CK_, DF_) e índices (IX_).
              - Las fechas se almacenan en UTC (SYSUTCDATETIME()).
   ============================================================================ */

USE GKMF;
GO

SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;   -- requerido por los índices filtrados
GO

/* ----------------------------------------------------------------------------
   1. usuario - Persona que usa la aplicación (o administra su contenido)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.usuario', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.usuario (
        id_usuario              INT           IDENTITY(1,1) NOT NULL,
        nombres                 NVARCHAR(80)  NOT NULL,
        apellidos               NVARCHAR(80)  NOT NULL,
        correo                  NVARCHAR(254) NOT NULL,
        hash_contrasena         VARCHAR(255)  NOT NULL,
        rol                     VARCHAR(15)   NOT NULL
            CONSTRAINT DF_usuario_rol DEFAULT ('USUARIO'),
        idioma                  CHAR(2)       NOT NULL
            CONSTRAINT DF_usuario_idioma DEFAULT ('es'),
        notificaciones_activas  BIT           NOT NULL
            CONSTRAINT DF_usuario_notificaciones DEFAULT (1),
        modo_offline_activo     BIT           NOT NULL
            CONSTRAINT DF_usuario_modo_offline DEFAULT (1),
        intentos_fallidos       TINYINT       NOT NULL
            CONSTRAINT DF_usuario_intentos DEFAULT (0),
        bloqueado_hasta         DATETIME2(0)  NULL,
        ultimo_acceso           DATETIME2(0)  NULL,
        activo                  BIT           NOT NULL
            CONSTRAINT DF_usuario_activo DEFAULT (1),
        fecha_registro          DATETIME2(0)  NOT NULL
            CONSTRAINT DF_usuario_fecha_registro DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT PK_usuario PRIMARY KEY CLUSTERED (id_usuario),
        CONSTRAINT UQ_usuario_correo UNIQUE (correo),
        CONSTRAINT CK_usuario_correo_formato
            CHECK (correo LIKE N'_%@_%._%' AND CHARINDEX(N' ', correo) = 0),
        CONSTRAINT CK_usuario_hash_longitud CHECK (LEN(hash_contrasena) >= 32),
        CONSTRAINT CK_usuario_rol CHECK (rol IN ('USUARIO', 'ADMINISTRADOR')),
        CONSTRAINT CK_usuario_idioma CHECK (idioma IN ('es', 'en'))
    );

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Persona registrada en GKMF (ahorrador o administrador de contenido). Nunca se elimina físicamente: se desactiva con activo = 0.',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'usuario';
END;
GO

/* ----------------------------------------------------------------------------
   2. sesion - Sesión iniciada; se guarda solo el hash del token de refresco
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.sesion', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.sesion (
        id_sesion            BIGINT       IDENTITY(1,1) NOT NULL,
        id_usuario           INT          NOT NULL,
        hash_token_refresco  CHAR(64)     NOT NULL,
        fecha_creacion       DATETIME2(0) NOT NULL
            CONSTRAINT DF_sesion_fecha_creacion DEFAULT (SYSUTCDATETIME()),
        fecha_expiracion     DATETIME2(0) NOT NULL,
        fecha_revocacion     DATETIME2(0) NULL,

        CONSTRAINT PK_sesion PRIMARY KEY CLUSTERED (id_sesion),
        CONSTRAINT UQ_sesion_hash_token UNIQUE (hash_token_refresco),
        CONSTRAINT FK_sesion_usuario FOREIGN KEY (id_usuario)
            REFERENCES dbo.usuario (id_usuario),
        CONSTRAINT CK_sesion_hash_hexadecimal
            CHECK (hash_token_refresco NOT LIKE '%[^0-9a-f]%'),
        CONSTRAINT CK_sesion_expiracion CHECK (fecha_expiracion > fecha_creacion),
        CONSTRAINT CK_sesion_revocacion
            CHECK (fecha_revocacion IS NULL OR fecha_revocacion >= fecha_creacion)
    );

    CREATE NONCLUSTERED INDEX IX_sesion_usuario
        ON dbo.sesion (id_usuario, fecha_revocacion);

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Sesión de un usuario. Guarda el hash SHA-256 del token de refresco (nunca el token) para poder revocarlo al cerrar sesión.',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'sesion';
END;
GO

/* ----------------------------------------------------------------------------
   3. categoria_movimiento - Catálogo para clasificar ingresos y egresos
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.categoria_movimiento', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.categoria_movimiento (
        id_categoria_movimiento  INT          IDENTITY(1,1) NOT NULL,
        nombre                   NVARCHAR(50) NOT NULL,
        tipo                     VARCHAR(7)   NOT NULL,
        icono                    VARCHAR(30)  NULL,

        CONSTRAINT PK_categoria_movimiento PRIMARY KEY CLUSTERED (id_categoria_movimiento),
        CONSTRAINT UQ_categoria_movimiento_nombre UNIQUE (nombre),
        CONSTRAINT CK_categoria_movimiento_tipo CHECK (tipo IN ('INGRESO', 'EGRESO'))
    );

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Catálogo de categorías para clasificar ingresos y egresos (Alimentación, Transporte, etc.).',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'categoria_movimiento';
END;
GO

/* ----------------------------------------------------------------------------
   4. meta_ahorro - Objetivo de ahorro de un usuario
      monto_ahorrado es un saldo controlado: solo cambia junto con una
      transacción DEPOSITO_META / RETIRO_META dentro de una misma transacción
      ACID (se implementa en la Fase III); nunca puede ser negativo.
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.meta_ahorro', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.meta_ahorro (
        id_meta              INT           IDENTITY(1,1) NOT NULL,
        id_usuario           INT           NOT NULL,
        codigo_global        UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_meta_ahorro_codigo_global DEFAULT (NEWID()),
        nombre               NVARCHAR(100) NOT NULL,
        descripcion          NVARCHAR(250) NULL,
        icono                VARCHAR(30)   NULL,
        monto_objetivo       DECIMAL(14,2) NOT NULL,
        monto_ahorrado       DECIMAL(14,2) NOT NULL
            CONSTRAINT DF_meta_ahorro_monto_ahorrado DEFAULT (0),
        fecha_limite         DATE          NOT NULL,
        estado               VARCHAR(12)   NOT NULL
            CONSTRAINT DF_meta_ahorro_estado DEFAULT ('EN_PROGRESO'),
        fecha_creacion       DATETIME2(0)  NOT NULL
            CONSTRAINT DF_meta_ahorro_fecha_creacion DEFAULT (SYSUTCDATETIME()),
        fecha_actualizacion  DATETIME2(0)  NOT NULL
            CONSTRAINT DF_meta_ahorro_fecha_actualizacion DEFAULT (SYSUTCDATETIME()),
        version_fila         ROWVERSION    NOT NULL,

        CONSTRAINT PK_meta_ahorro PRIMARY KEY CLUSTERED (id_meta),
        CONSTRAINT UQ_meta_ahorro_codigo_global UNIQUE (codigo_global),
        -- Necesaria como destino de la FK compuesta desde transaccion.
        CONSTRAINT UQ_meta_ahorro_id_usuario UNIQUE (id_meta, id_usuario),
        CONSTRAINT FK_meta_ahorro_usuario FOREIGN KEY (id_usuario)
            REFERENCES dbo.usuario (id_usuario),
        CONSTRAINT CK_meta_ahorro_objetivo_positivo CHECK (monto_objetivo > 0),
        CONSTRAINT CK_meta_ahorro_ahorrado_no_negativo CHECK (monto_ahorrado >= 0),
        CONSTRAINT CK_meta_ahorro_estado
            CHECK (estado IN ('EN_PROGRESO', 'COMPLETADA', 'PAUSADA', 'ATRASADA')),
        -- fecha_creacion está en UTC y fecha_limite es la fecha local del usuario (Bogotá, UTC-5): entre las 19:00 y
        -- las 23:59 locales la fecha UTC ya es la de "mañana", por lo que se tolera un día para no rechazar una meta
        -- legítima con fecha límite "hoy".
        CONSTRAINT CK_meta_ahorro_fecha_limite
            CHECK (fecha_limite >= DATEADD(DAY, -1, CAST(fecha_creacion AS DATE))),
        CONSTRAINT CK_meta_ahorro_completada
            CHECK (estado <> 'COMPLETADA' OR monto_ahorrado >= monto_objetivo)
    );

    CREATE NONCLUSTERED INDEX IX_meta_ahorro_usuario_estado
        ON dbo.meta_ahorro (id_usuario, estado)
        INCLUDE (nombre, monto_objetivo, monto_ahorrado, fecha_limite);

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Meta de ahorro de un usuario, con monto objetivo, saldo ahorrado (nunca negativo), fecha límite y estado.',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'meta_ahorro';
END;
GO

/* ----------------------------------------------------------------------------
   5. sincronizacion - Sesión de sincronización entre la base local (SQLite)
      del dispositivo y el servidor (soporte del modo sin conexión)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.sincronizacion', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.sincronizacion (
        id_sincronizacion         BIGINT        IDENTITY(1,1) NOT NULL,
        id_usuario                INT           NOT NULL,
        identificador_dispositivo NVARCHAR(100) NOT NULL,
        fecha_inicio              DATETIME2(0)  NOT NULL
            CONSTRAINT DF_sincronizacion_fecha_inicio DEFAULT (SYSUTCDATETIME()),
        fecha_fin                 DATETIME2(0)  NULL,
        estado                    VARCHAR(10)   NOT NULL
            CONSTRAINT DF_sincronizacion_estado DEFAULT ('EN_CURSO'),
        operaciones_recibidas     INT           NOT NULL
            CONSTRAINT DF_sincronizacion_recibidas DEFAULT (0),
        operaciones_aplicadas     INT           NOT NULL
            CONSTRAINT DF_sincronizacion_aplicadas DEFAULT (0),
        detalle_error             NVARCHAR(500) NULL,

        CONSTRAINT PK_sincronizacion PRIMARY KEY CLUSTERED (id_sincronizacion),
        -- Necesaria como destino de la FK compuesta desde transaccion.
        CONSTRAINT UQ_sincronizacion_id_usuario UNIQUE (id_sincronizacion, id_usuario),
        CONSTRAINT FK_sincronizacion_usuario FOREIGN KEY (id_usuario)
            REFERENCES dbo.usuario (id_usuario),
        CONSTRAINT CK_sincronizacion_estado
            CHECK (estado IN ('EN_CURSO', 'COMPLETADA', 'PARCIAL', 'FALLIDA')),
        CONSTRAINT CK_sincronizacion_operaciones
            CHECK (operaciones_recibidas >= 0
                   AND operaciones_aplicadas >= 0
                   AND operaciones_aplicadas <= operaciones_recibidas),
        CONSTRAINT CK_sincronizacion_fin
            CHECK ((estado = 'EN_CURSO' AND fecha_fin IS NULL)
                   OR (estado <> 'EN_CURSO' AND fecha_fin IS NOT NULL AND fecha_fin >= fecha_inicio))
    );

    CREATE NONCLUSTERED INDEX IX_sincronizacion_usuario_fecha
        ON dbo.sincronizacion (id_usuario, fecha_inicio DESC);

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Sesión de sincronización de un dispositivo con el servidor: cuántas operaciones offline se recibieron y cuántas se aplicaron.',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'sincronizacion';
END;
GO

/* ----------------------------------------------------------------------------
   6. transaccion - Movimiento financiero (libro mayor de solo inserción)
      tipo INGRESO / EGRESO      : requiere categoría y no pertenece a una meta
      tipo DEPOSITO_META / RETIRO_META : requiere meta y no lleva categoría
      Las FK compuestas (id_meta, id_usuario) e (id_sincronizacion, id_usuario)
      impiden que un movimiento del usuario A referencie datos del usuario B.
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.transaccion', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.transaccion (
        id_transaccion           BIGINT        IDENTITY(1,1) NOT NULL,
        id_usuario               INT           NOT NULL,
        id_meta                  INT           NULL,
        id_categoria_movimiento  INT           NULL,
        id_sincronizacion        BIGINT        NULL,
        codigo_global            UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_transaccion_codigo_global DEFAULT (NEWID()),
        tipo                     VARCHAR(14)   NOT NULL,
        monto                    DECIMAL(14,2) NOT NULL,
        descripcion              NVARCHAR(150) NOT NULL,
        fecha_movimiento         DATETIME2(0)  NOT NULL
            CONSTRAINT DF_transaccion_fecha_movimiento DEFAULT (SYSUTCDATETIME()),
        fecha_registro           DATETIME2(0)  NOT NULL
            CONSTRAINT DF_transaccion_fecha_registro DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT PK_transaccion PRIMARY KEY CLUSTERED (id_transaccion),
        CONSTRAINT UQ_transaccion_codigo_global UNIQUE (codigo_global),
        CONSTRAINT FK_transaccion_usuario FOREIGN KEY (id_usuario)
            REFERENCES dbo.usuario (id_usuario),
        CONSTRAINT FK_transaccion_meta FOREIGN KEY (id_meta, id_usuario)
            REFERENCES dbo.meta_ahorro (id_meta, id_usuario),
        CONSTRAINT FK_transaccion_categoria FOREIGN KEY (id_categoria_movimiento)
            REFERENCES dbo.categoria_movimiento (id_categoria_movimiento),
        CONSTRAINT FK_transaccion_sincronizacion FOREIGN KEY (id_sincronizacion, id_usuario)
            REFERENCES dbo.sincronizacion (id_sincronizacion, id_usuario),
        CONSTRAINT CK_transaccion_tipo
            CHECK (tipo IN ('INGRESO', 'EGRESO', 'DEPOSITO_META', 'RETIRO_META')),
        CONSTRAINT CK_transaccion_monto_positivo CHECK (monto > 0),
        CONSTRAINT CK_transaccion_coherencia CHECK (
               (tipo IN ('INGRESO', 'EGRESO')
                    AND id_meta IS NULL AND id_categoria_movimiento IS NOT NULL)
            OR (tipo IN ('DEPOSITO_META', 'RETIRO_META')
                    AND id_meta IS NOT NULL AND id_categoria_movimiento IS NULL))
    );

    CREATE NONCLUSTERED INDEX IX_transaccion_usuario_fecha
        ON dbo.transaccion (id_usuario, fecha_movimiento DESC)
        INCLUDE (tipo, monto, descripcion);
    CREATE NONCLUSTERED INDEX IX_transaccion_meta
        ON dbo.transaccion (id_meta) WHERE id_meta IS NOT NULL;
    CREATE NONCLUSTERED INDEX IX_transaccion_categoria
        ON dbo.transaccion (id_categoria_movimiento) WHERE id_categoria_movimiento IS NOT NULL;
    CREATE NONCLUSTERED INDEX IX_transaccion_sincronizacion
        ON dbo.transaccion (id_sincronizacion) WHERE id_sincronizacion IS NOT NULL;

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Movimiento financiero (ingreso, egreso, depósito o retiro de una meta). Libro mayor de solo inserción: no se modifica ni se elimina.',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'transaccion';
END;
GO

/* ----------------------------------------------------------------------------
   7. categoria_leccion - Temas de educación financiera
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.categoria_leccion', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.categoria_leccion (
        id_categoria_leccion  INT           IDENTITY(1,1) NOT NULL,
        nombre                NVARCHAR(50)  NOT NULL,
        descripcion           NVARCHAR(200) NULL,
        icono                 VARCHAR(30)   NULL,

        CONSTRAINT PK_categoria_leccion PRIMARY KEY CLUSTERED (id_categoria_leccion),
        CONSTRAINT UQ_categoria_leccion_nombre UNIQUE (nombre)
    );

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Tema de educación financiera (Ahorro, Crédito, Presupuesto, Protección, Inversión, Familia).',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'categoria_leccion';
END;
GO

/* ----------------------------------------------------------------------------
   8. leccion - Lección corta de educación financiera
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.leccion', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.leccion (
        id_leccion            INT           IDENTITY(1,1) NOT NULL,
        id_categoria_leccion  INT           NOT NULL,
        titulo                NVARCHAR(150) NOT NULL,
        resumen               NVARCHAR(300) NOT NULL,
        contenido             NVARCHAR(MAX) NULL,
        duracion_minutos      TINYINT       NOT NULL,
        orden                 SMALLINT      NOT NULL
            CONSTRAINT DF_leccion_orden DEFAULT (1),
        es_destacada          BIT           NOT NULL
            CONSTRAINT DF_leccion_es_destacada DEFAULT (0),
        activa                BIT           NOT NULL
            CONSTRAINT DF_leccion_activa DEFAULT (1),

        CONSTRAINT PK_leccion PRIMARY KEY CLUSTERED (id_leccion),
        CONSTRAINT UQ_leccion_titulo UNIQUE (titulo),
        CONSTRAINT FK_leccion_categoria FOREIGN KEY (id_categoria_leccion)
            REFERENCES dbo.categoria_leccion (id_categoria_leccion),
        CONSTRAINT CK_leccion_duracion CHECK (duracion_minutos BETWEEN 1 AND 120),
        CONSTRAINT CK_leccion_orden CHECK (orden > 0)
    );

    CREATE NONCLUSTERED INDEX IX_leccion_categoria_orden
        ON dbo.leccion (id_categoria_leccion, orden);
    -- A lo sumo una "Lección del día" a la vez.
    CREATE UNIQUE NONCLUSTERED INDEX UX_leccion_destacada
        ON dbo.leccion (es_destacada) WHERE es_destacada = 1;

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Lección corta de educación financiera perteneciente a una categoría. Solo una puede ser la lección del día.',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'leccion';
END;
GO

/* ----------------------------------------------------------------------------
   9. progreso_leccion - Avance de un usuario en una lección (N:M usuario-lección)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.progreso_leccion', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.progreso_leccion (
        id_usuario              INT          NOT NULL,
        id_leccion              INT          NOT NULL,
        porcentaje              TINYINT      NOT NULL
            CONSTRAINT DF_progreso_leccion_porcentaje DEFAULT (0),
        completada              BIT          NOT NULL
            CONSTRAINT DF_progreso_leccion_completada DEFAULT (0),
        fecha_inicio            DATETIME2(0) NOT NULL
            CONSTRAINT DF_progreso_leccion_fecha_inicio DEFAULT (SYSUTCDATETIME()),
        fecha_ultima_actividad  DATETIME2(0) NOT NULL
            CONSTRAINT DF_progreso_leccion_ultima DEFAULT (SYSUTCDATETIME()),
        fecha_completado        DATETIME2(0) NULL,

        CONSTRAINT PK_progreso_leccion PRIMARY KEY CLUSTERED (id_usuario, id_leccion),
        CONSTRAINT FK_progreso_leccion_usuario FOREIGN KEY (id_usuario)
            REFERENCES dbo.usuario (id_usuario),
        CONSTRAINT FK_progreso_leccion_leccion FOREIGN KEY (id_leccion)
            REFERENCES dbo.leccion (id_leccion),
        CONSTRAINT CK_progreso_leccion_porcentaje CHECK (porcentaje BETWEEN 0 AND 100),
        CONSTRAINT CK_progreso_leccion_completada CHECK (
               (completada = 0 AND fecha_completado IS NULL AND porcentaje < 100)
            OR (completada = 1 AND fecha_completado IS NOT NULL AND porcentaje = 100))
    );

    CREATE NONCLUSTERED INDEX IX_progreso_leccion_leccion
        ON dbo.progreso_leccion (id_leccion);

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Avance de un usuario en una lección (porcentaje y fecha de finalización). Resuelve la relación N:M entre usuario y lección.',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'progreso_leccion';
END;
GO

/* ----------------------------------------------------------------------------
   10. logro - Catálogo de logros (insignias) que el usuario puede obtener
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.logro', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.logro (
        id_logro     INT           IDENTITY(1,1) NOT NULL,
        codigo       VARCHAR(30)   NOT NULL,
        nombre       NVARCHAR(60)  NOT NULL,
        descripcion  NVARCHAR(200) NOT NULL,
        icono        VARCHAR(30)   NULL,

        CONSTRAINT PK_logro PRIMARY KEY CLUSTERED (id_logro),
        CONSTRAINT UQ_logro_codigo UNIQUE (codigo),
        CONSTRAINT UQ_logro_nombre UNIQUE (nombre)
    );

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Catálogo de logros o insignias (Primera meta, 3 lecciones, 7 días activa, Meta cumplida, Constancia).',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'logro';
END;
GO

/* ----------------------------------------------------------------------------
   11. usuario_logro - Logro obtenido por un usuario (N:M usuario-logro)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.usuario_logro', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.usuario_logro (
        id_usuario       INT          NOT NULL,
        id_logro         INT          NOT NULL,
        fecha_obtencion  DATETIME2(0) NOT NULL
            CONSTRAINT DF_usuario_logro_fecha DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT PK_usuario_logro PRIMARY KEY CLUSTERED (id_usuario, id_logro),
        CONSTRAINT FK_usuario_logro_usuario FOREIGN KEY (id_usuario)
            REFERENCES dbo.usuario (id_usuario),
        CONSTRAINT FK_usuario_logro_logro FOREIGN KEY (id_logro)
            REFERENCES dbo.logro (id_logro)
    );

    CREATE NONCLUSTERED INDEX IX_usuario_logro_logro
        ON dbo.usuario_logro (id_logro);

    EXEC sys.sp_addextendedproperty @name = N'MS_Description',
        @value = N'Logro obtenido por un usuario y la fecha en que lo obtuvo. Resuelve la relación N:M entre usuario y logro.',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'usuario_logro';
END;
GO

PRINT N'Esquema GKMF listo: 11 tablas.';
GO
