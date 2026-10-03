#!/bin/sh
set -e
echo "[TransportManager] Opstarten..."
mkdir -p "${DATA_DIR:-/data}"
# De database wordt bij het opstarten zelf bijgewerkt (zonder dataverlies).
exec node src/server.js
