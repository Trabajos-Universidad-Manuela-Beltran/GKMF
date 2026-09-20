/* ============================================================================
   GKMF - Garantía de Conocimiento y Movilidad Financiera
   Script 01: Creación de la base de datos

   Motor    : Microsoft SQL Server 2019 o superior (probado en SQL Server 2022)
   Ejecutar : SSMS -> conectarse a la instancia -> abrir este archivo -> F5
              o bien: sqlcmd -S <instancia> -E -f 65001 -b -i 01_crear_base_datos.sql
   Notas    : - Es idempotente: si la base de datos ya existe no se modifica.
              - La intercalación Modern_Spanish_CI_AS ordena correctamente los
                caracteres del español (ñ, tildes) y compara sin distinguir
                mayúsculas, lo que hace que la unicidad del correo sea
                insensible a mayúsculas.
   ============================================================================ */

USE master;
GO

IF DB_ID(N'GKMF') IS NULL
BEGIN
    CREATE DATABASE GKMF COLLATE Modern_Spanish_CI_AS;
    PRINT N'Base de datos GKMF creada.';
END
ELSE
BEGIN
    PRINT N'La base de datos GKMF ya existe; no se realizaron cambios.';
END
GO
