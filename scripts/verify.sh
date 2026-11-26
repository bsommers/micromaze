#!/usr/bin/env bash
# MicroMaze post-build gate — silent-ish success, nonzero on fail.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== lint:imports =="
npm run lint:imports

echo "== test =="
npm test

echo "== validate store01 =="
npm run validate

echo "== botplay =="
npm run botplay

if curl -sf -o /dev/null http://127.0.0.1:4880/; then
  echo "== tracker :4880 ok =="
else
  echo "== tracker :4880 not running (warn) =="
fi

echo "VERIFY OK"
