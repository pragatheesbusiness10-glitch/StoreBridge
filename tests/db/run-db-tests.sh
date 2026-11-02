#!/usr/bin/env bash
# Applies all migrations to a fresh throwaway database and runs the Prime Physique SQL tests.
# Requires a local PostgreSQL 15+ (set PGHOST / PGPORT / PGUSER as needed).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
"$ROOT/tests/db/run-migrations.sh" pp_test
psql -U postgres -d pp_test -v ON_ERROR_STOP=1 -f "$ROOT/tests/db/prime-physique.test.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /PASSED/p; /ERROR/p'
