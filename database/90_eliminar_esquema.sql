/* ============================================================================
   GKMF - Garantía de Conocimiento y Movilidad Financiera
   Script 90: Eliminar TODAS las tablas del esquema (DESTRUCTIVO)

   Uso      : solo en entornos de desarrollo, para reiniciar el esquema y
              volver a ejecutar 02_crear_tablas.sql y 03_datos_iniciales.sql.
   Seguridad: el script no hace nada mientras @confirmar = 0. Cambie el valor
              a 1 conscientemente para ejecutarlo. Borra todos los datos.
   ============================================================================ */

USE GKMF;
GO

DECLARE @confirmar BIT = 0;   -- <-- cambiar a 1 para confirmar el borrado

IF @confirmar = 0
    THROW 50002, N'Operación cancelada: este script elimina todas las tablas y datos. Cambie @confirmar a 1 para continuar.', 1;

-- Orden inverso a las dependencias (hijas antes que padres)
DROP TABLE IF EXISTS dbo.usuario_logro;
DROP TABLE IF EXISTS dbo.progreso_leccion;
DROP TABLE IF EXISTS dbo.transaccion;
DROP TABLE IF EXISTS dbo.leccion;
DROP TABLE IF EXISTS dbo.sincronizacion;
DROP TABLE IF EXISTS dbo.meta_ahorro;
DROP TABLE IF EXISTS dbo.sesion;
DROP TABLE IF EXISTS dbo.logro;
DROP TABLE IF EXISTS dbo.categoria_leccion;
DROP TABLE IF EXISTS dbo.categoria_movimiento;
DROP TABLE IF EXISTS dbo.usuario;

PRINT N'Esquema eliminado. Vuelva a ejecutar 02_crear_tablas.sql y 03_datos_iniciales.sql.';
GO
