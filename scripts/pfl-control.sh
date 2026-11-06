#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ -z "${PF_DATA_INGEST_SECRET:-}" ]; then
  if ! [ -t 0 ]; then
    echo "Inject PF_DATA_INGEST_SECRET securely or run from an interactive terminal." >&2
    exit 1
  fi
  printf 'PFL admin secret (hidden, not saved): ' >&2
  trap 'stty echo < /dev/tty' EXIT
  trap 'exit 1' INT TERM HUP
  stty -echo < /dev/tty
  IFS= read -r PF_DATA_INGEST_SECRET < /dev/tty
  stty echo < /dev/tty
  trap - EXIT INT TERM HUP
  printf '\n' >&2
  export PF_DATA_INGEST_SECRET
fi
exec node scripts/pfl-control.mjs "$@"
