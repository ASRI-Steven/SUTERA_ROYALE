#!/bin/sh
# Dobel-klik (macOS): pantau GitHub & tarik update Sutera Royale otomatis. Biarkan jendela Terminal ini terbuka.
cd "$(dirname "$0")" || exit 1
exec go run . "$@"
