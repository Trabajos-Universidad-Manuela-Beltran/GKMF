/* ============================================================================
   GKMF - Garantía de Conocimiento y Movilidad Financiera
   Script 04 (OPCIONAL): Rol de mínimos privilegios para la API

   Objetivo : que el backend NO se conecte como sa/dbo, sino con una cuenta
              que solo pueda hacer lo estrictamente necesario (principio de
              mínimo privilegio, OWASP ASVS V1.4 / A01:2021).
   Requiere : 01, 02 (y 03 si se desean datos de prueba). Ejecutar con un
              inicio de sesión con permisos de administrador (sysadmin).
   Ejecutar : - SSMS: reemplace el marcador de la línea "DECLARE @clave" por una
                contraseña fuerte y presione F5 (sin subir ese cambio al repositorio).
              - sqlcmd: defina la variable de entorno GKMF_API_PASSWORD (así la clave
                        no queda en la línea de comandos) y ejecute
                        sqlcmd -S <instancia> -E -f 65001 -b -I -i 04_seguridad_rol_api.sql
                        (alternativa: agregar -v GKMF_API_PASSWORD="<clave>")
   IMPORTANTE:
     - La contraseña debe ser fuerte (mínimo 16 caracteres, con mayúsculas,
       minúsculas, números y símbolos) y NO puede contener comilla simple (').
       Guárdela solo en el archivo .env del backend (ignorado por git).
     - El script se niega a ejecutarse mientras @clave conserve el marcador.
   Permisos concedidos:
     - transaccion       : SELECT e INSERT (libro mayor de solo inserción).
     - resto de tablas   : SELECT, INSERT y UPDATE según corresponda.
     - Ninguna tabla     : DELETE (se deniega de forma explícita).
     - usuario.rol       : UPDATE denegado (la API no puede cambiar el rol de nadie).
   Pendiente para la Fase III (endurecimiento adicional):
     - Los cambios de meta_ahorro.monto_ahorrado deben pasar a procedimientos
       almacenados con EXECUTE AS OWNER (insertan el movimiento y actualizan el
       saldo en una sola transacción); entonces se deniega el UPDATE directo de
       esa columna. Hoy el invariante lo vigila 99_verificacion.sql.
     - Separar un rol de administración de contenido: los catálogos (lecciones,
       logros, categorías) hoy admiten INSERT/UPDATE desde la API.
   ============================================================================ */

USE GKMF;
GO

SET NOCOUNT ON;
GO

DECLARE @clave NVARCHAR(128) = N'$(GKMF_API_PASSWORD)';   -- sqlcmd reemplaza este marcador con la opción -v; en SSMS se edita a mano

IF @clave LIKE N'%GKMF[_]API[_]PASSWORD%' OR LEN(@clave) < 16   -- el marcador sin reemplazar conserva el nombre de la variable
    THROW 50001, N'Defina una contraseña fuerte de al menos 16 caracteres (variable GKMF_API_PASSWORD de sqlcmd o edite @clave) antes de ejecutar este script.', 1;

-- 1) Rol con los permisos mínimos
IF DATABASE_PRINCIPAL_ID(N'rol_api_gkmf') IS NULL
    CREATE ROLE rol_api_gkmf;

-- 2) Inicio de sesión de servidor y usuario de base de datos para la API.
--    El script converge: si el inicio de sesión ya existe se actualiza su contraseña (así un cambio de
--    GKMF_API_PASSWORD se aplica al volver a ejecutarlo) y si el usuario de base de datos quedó huérfano
--    (por ejemplo, tras restaurar la base en otra instancia) se vuelve a enlazar con su inicio de sesión.
DECLARE @sql NVARCHAR(MAX);
DECLARE @clave_sql NVARCHAR(300) = REPLACE(@clave, N'''', N'''''');

IF SUSER_ID(N'gkmf_api') IS NULL
    SET @sql = N'CREATE LOGIN gkmf_api WITH PASSWORD = N''' + @clave_sql +
               N''', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = GKMF;';
ELSE
    SET @sql = N'ALTER LOGIN gkmf_api WITH PASSWORD = N''' + @clave_sql + N''';';
EXEC (@sql);

IF DATABASE_PRINCIPAL_ID(N'gkmf_api') IS NULL
    CREATE USER gkmf_api FOR LOGIN gkmf_api WITH DEFAULT_SCHEMA = dbo;
ELSE
    ALTER USER gkmf_api WITH LOGIN = gkmf_api;

ALTER ROLE rol_api_gkmf ADD MEMBER gkmf_api;
GO

-- 3) Permisos por tabla
GRANT SELECT, INSERT, UPDATE ON dbo.usuario              TO rol_api_gkmf;
GRANT SELECT, INSERT, UPDATE ON dbo.sesion               TO rol_api_gkmf;
GRANT SELECT, INSERT, UPDATE ON dbo.meta_ahorro          TO rol_api_gkmf;
GRANT SELECT, INSERT, UPDATE ON dbo.sincronizacion       TO rol_api_gkmf;
GRANT SELECT, INSERT         ON dbo.transaccion          TO rol_api_gkmf;
GRANT SELECT, INSERT, UPDATE ON dbo.progreso_leccion     TO rol_api_gkmf;
GRANT SELECT, INSERT         ON dbo.usuario_logro        TO rol_api_gkmf;
GRANT SELECT, INSERT, UPDATE ON dbo.categoria_movimiento TO rol_api_gkmf;
GRANT SELECT, INSERT, UPDATE ON dbo.categoria_leccion    TO rol_api_gkmf;
GRANT SELECT, INSERT, UPDATE ON dbo.leccion              TO rol_api_gkmf;
GRANT SELECT, INSERT, UPDATE ON dbo.logro                TO rol_api_gkmf;

-- 4) Defensa en profundidad: ni borrar filas, ni alterar el libro mayor, ni cambiar el rol de un usuario
--    (un DENY a nivel de columna prevalece sobre el GRANT de la tabla)
DENY DELETE ON SCHEMA::dbo TO rol_api_gkmf;
DENY UPDATE ON dbo.transaccion TO rol_api_gkmf;
DENY UPDATE (rol) ON dbo.usuario TO rol_api_gkmf;   -- una inyección SQL no puede elevarse a ADMINISTRADOR
GO

PRINT N'Rol rol_api_gkmf y usuario gkmf_api configurados con mínimo privilegio.';
GO
