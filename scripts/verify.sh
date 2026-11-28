#!/usr/bin/env bash
# MicroMaze post-build gate — silent-ish success, nonzero on fail.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== lint:imports =="
npm run lint:imports

echo "== test =="
npm test

echo "== validate levels =="
for f in src/levels/*.json; do node tools/validate-level.mjs "$f"; done

echo "== botplay =="
npm run botplay
for f in src/levels/*.json; do
  L="$(basename "$f" .json)"
  echo "-- $L (informational: level difficulty varies)"
  node tools/botplay.mjs --level $L --seeds 1,2,3,4,5 | tail -1 || true
done

if curl -sf -o /dev/null http://127.0.0.1:4880/; then
  echo "== tracker :4880 ok =="
else
  echo "== tracker :4880 not running (warn) =="
fi

echo "VERIFY OK"
