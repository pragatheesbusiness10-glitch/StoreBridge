#!/usr/bin/env bash
# Recreates a throwaway database and applies the Supabase stub + every migration in order.
# Usage: PGHOST=/tmp PGPORT=54329 tests/db/run-migrations.sh [dbname]
set -euo pipefail
DB=${1:-pp_test}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
psql -U postgres -d postgres -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -f "$ROOT/tests/db/supabase-stub.sql"
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  case "$(basename "$f")" in
    *prime_physique*)
      # Prime Physique migrations must apply cleanly.
      psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "FAILED: $f"; exit 1; } ;;
    *)
      # Pre-existing StoreBridge migrations include data fixes that reference production
      # user ids; those statements cannot succeed on an empty test database.
      psql -U postgres -d "$DB" -q -f "$f" >/dev/null 2>"/tmp/pp-mig-$(basename "$f").err" || true ;;
  esac
done
echo "Applied $(ls "$ROOT"/supabase/migrations/*.sql | wc -l) migrations to $DB"
