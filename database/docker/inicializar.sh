#!/bin/bash
# ============================================================================
# GKMF - Inicialización automática de la base de datos (uso con docker compose)
# Ejecuta, en orden, los scripts SQL contra el contenedor "db".
# Variables requeridas : SQLCMDPASSWORD (clave de sa; sqlcmd la lee del entorno,
#                        así no aparece en la lista de procesos)
# Variables opcionales : GKMF_API_PASSWORD (si se define, crea la cuenta gkmf_api;
#                        el script 04 la toma del entorno como variable de sqlcmd)
# ============================================================================
set -euo pipefail

: "${SQLCMDPASSWORD:?Falta SQLCMDPASSWORD (clave del administrador sa)}"

SQLCMD=(/opt/mssql-tools18/bin/sqlcmd -S db -U sa -C -f 65001 -b -I)
SCRIPTS=/scripts

echo ">> 01 - crear base de datos";  "${SQLCMD[@]}" -i "${SCRIPTS}/01_crear_base_datos.sql"
echo ">> 02 - crear tablas";         "${SQLCMD[@]}" -i "${SCRIPTS}/02_crear_tablas.sql"
echo ">> 03 - datos iniciales";      "${SQLCMD[@]}" -i "${SCRIPTS}/03_datos_iniciales.sql"

if [[ -n "${GKMF_API_PASSWORD:-}" ]]; then
  if [[ "${GKMF_API_PASSWORD}" == *"'"* ]]; then
    echo "ERROR: GKMF_API_PASSWORD no puede contener comilla simple (')." >&2
    exit 1
  fi
  echo ">> 04 - rol de mínimo privilegio (cuenta gkmf_api)"
  "${SQLCMD[@]}" -i "${SCRIPTS}/04_seguridad_rol_api.sql"
else
  echo ">> 04 - omitido (defina GKMF_API_PASSWORD para crear la cuenta de mínimo privilegio)"
fi

echo ">> 99 - verificación"
# sqlcmd escribe los errores en la salida estándar: se captura y solo se muestra si algo falla.
if ! salida=$("${SQLCMD[@]}" -i "${SCRIPTS}/99_verificacion.sql" 2>&1); then
  echo "ERROR: la verificación 99_verificacion.sql falló:" >&2
  echo "${salida}" >&2
  exit 1
fi
echo "Base de datos GKMF lista."
