#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# No ports, network, volumes or remote credentials: the container is disposable.
test_container="ai-daily-db-test-$$"
race_results="$(mktemp -d)"
trap 'docker rm -f "$test_container" >/dev/null 2>&1 || true; rm -rf "$race_results"' EXIT
docker run --pull=never --name "$test_container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:16 >/dev/null
for attempt in {1..30}; do
  if docker exec "$test_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.2
done
run_sql() { docker exec -i "$test_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres < "$1"; }
run_sql supabase/tests/bootstrap.sql
if [[ "${1:-}" != "--baseline" ]]; then
  for migration in supabase/migrations/*.sql; do run_sql "$migration"; done
fi
run_sql supabase/tests/drafts.sql
run_sql supabase/tests/foundation.sql
run_sql supabase/tests/scheduler.sql
docker exec "$test_container" cat /tmp/ai-daily-contract.json | node --experimental-strip-types scripts/check-db-contract.mjs
run_sql supabase/tests/concurrency.sql
set +e
run_sql supabase/tests/approve.sql >"$race_results/first" 2>&1 & first_pid=$!
run_sql supabase/tests/approve.sql >"$race_results/second" 2>&1 & second_pid=$!
wait "$first_pid"; first_status=$?
wait "$second_pid"; second_status=$?
set -e
if ! { [[ "$first_status" = 0 && "$second_status" = 3 ]] || [[ "$first_status" = 3 && "$second_status" = 0 ]]; }; then
  cat "$race_results/first" "$race_results/second"
  exit 1
fi
# grep, not rg: the harness must run on a machine without ripgrep installed.
grep -qr 'Story changed; reload before deciding' "$race_results"
count="$(docker exec "$test_container" psql -X -At -U postgres -c 'select count(*) from private.reviews')"
[[ "$count" = 1 ]]
echo 'Concurrent approvals: one accepted, one stale, one review recorded.'
echo 'PostgreSQL foundation assertions passed.' 
