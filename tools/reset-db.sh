#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"

if ! docker compose ps db >/dev/null 2>&1; then
  echo "Docker Compose no esta disponible o el servicio db no existe." >&2
  exit 1
fi

echo "Reseteando base de datos del laboratorio..."
docker compose exec -T db psql -U gym -d gym_lab < db/reset_lab.sql
echo "Base de datos reseteada."
