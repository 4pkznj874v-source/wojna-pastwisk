#!/usr/bin/env sh
set -e
if ! command -v node >/dev/null 2>&1; then
  echo "Brak Node.js. Zainstaluj Node.js 20 lub nowszy."
  exit 1
fi
npm install
npm start
