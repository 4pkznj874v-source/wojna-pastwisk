#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Brak Node.js 20+"; exit 1; fi
npm install
npm start
