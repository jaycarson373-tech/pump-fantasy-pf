#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec railway run --project c2b1929e-3fd4-46b7-98ca-f248cb594774 --service 94656ee0-803b-45d2-990c-5744301c8295 --environment production --no-local -- node scripts/open-draft.mjs "${1:-open}"
