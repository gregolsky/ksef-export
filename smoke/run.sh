#!/usr/bin/env bash
# Smoke test runner. Exits 0 only if all scenarios pass.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="docker compose -f $SCRIPT_DIR/docker-compose.smoke.yml"
PASS=0
FAIL=0

# ─── helpers ────────────────────────────────────────────────────────────────

info()  { echo "  [smoke] $*"; }
ok()    { echo "  ✓ $*"; ((PASS++)) || true; }
fail()  { echo "  ✗ $*"; ((FAIL++)) || true; }

assert_file_exists() {
  local label="$1" path="$2"
  if docker compose -f "$SCRIPT_DIR/docker-compose.smoke.yml" run --rm --no-deps \
      -v smoke_inbox:/inbox:ro ksef-downloader \
      sh -c "test -f /inbox/$path" 2>/dev/null; then
    ok "$label: file exists — $path"
  else
    fail "$label: expected file missing — $path"
  fi
}

assert_no_file() {
  local label="$1" path="$2"
  if ! docker compose -f "$SCRIPT_DIR/docker-compose.smoke.yml" run --rm --no-deps \
      -v smoke_inbox:/inbox:ro ksef-downloader \
      sh -c "test -f /inbox/$path" 2>/dev/null; then
    ok "$label: file absent — $path"
  else
    fail "$label: expected absence but file exists — $path"
  fi
}

log_count() {
  # count lines in a log file inside the logs volume
  local service="$1" logfile="$2"
  docker compose -f "$SCRIPT_DIR/docker-compose.smoke.yml" run --rm --no-deps \
    -v smoke_logs:/logs:ro "$service" \
    sh -c "wc -l < /logs/$logfile 2>/dev/null || echo 0" 2>/dev/null | tr -d '[:space:]'
}

run_downloader() {
  local year="${1:-2026}" month="${2:-4}" extra="${3:-}"
  $COMPOSE run --rm ksef-downloader --year "$year" --month "$month" $extra
}

teardown() {
  $COMPOSE down -v --remove-orphans 2>/dev/null || true
}

# ─── scenario 1: happy path, both sinks healthy ─────────────────────────────

info "Scenario 1: happy path — both sinks healthy"
teardown
$COMPOSE up -d --build mock-ksef stub-sink-a stub-sink-b
$COMPOSE up -d --wait mock-ksef stub-sink-a stub-sink-b 2>/dev/null || true

if run_downloader 2026 4; then
  ok "Scenario 1: downloader exited 0"
else
  fail "Scenario 1: downloader non-zero exit"
fi

assert_file_exists "Scenario 1" "2026/04/received/20260401-RR-ABCDEF123456-20260401-1.pdf"
assert_file_exists "Scenario 1" "2026/04/.sink-a-synced"
assert_file_exists "Scenario 1" "2026/04/.sink-b-synced"

# ─── scenario 2: multi-sink fan-out — sink-b fails ──────────────────────────

info "Scenario 2: multi-sink fan-out — sink-b FORCE_FAIL=1"
teardown
SINK_B_FAIL=1 $COMPOSE up -d --build mock-ksef stub-sink-a stub-sink-b
SINK_B_FAIL=1 $COMPOSE up -d --wait mock-ksef stub-sink-a stub-sink-b 2>/dev/null || true

if SINK_B_FAIL=1 run_downloader 2026 4; then
  ok "Scenario 2: downloader exited 0 (at least one sink ok)"
else
  fail "Scenario 2: downloader non-zero exit despite sink-a being healthy"
fi

assert_file_exists "Scenario 2" "2026/04/.sink-a-synced"
assert_no_file    "Scenario 2" "2026/04/.sink-b-synced"

# ─── scenario 3: idempotency ────────────────────────────────────────────────

info "Scenario 3: idempotency — rerun scenario 1"
teardown
$COMPOSE up -d --build mock-ksef stub-sink-a stub-sink-b
$COMPOSE up -d --wait mock-ksef stub-sink-a stub-sink-b 2>/dev/null || true

run_downloader 2026 4 >/dev/null 2>&1 || true  # first run
run_downloader 2026 4 >/dev/null 2>&1 && ok "Scenario 3: second run exited 0" || fail "Scenario 3: second run failed"

# Both sinks should have received 2 events
COUNT_A=$(log_count stub-sink-a sink-a-events.jsonl)
if [ "$COUNT_A" -ge 2 ] 2>/dev/null; then
  ok "Scenario 3: sink-a received $COUNT_A events"
else
  fail "Scenario 3: sink-a event count was $COUNT_A (expected ≥2)"
fi

# ─── scenario 4: empty month ────────────────────────────────────────────────

info "Scenario 4: empty month"
teardown
SMOKE_SUBJECT=received $COMPOSE build mock-ksef >/dev/null 2>&1 || true

# Rebuild mock-ksef with empty fixture
docker build -t smoke-mock-ksef-empty \
  --build-arg FIXTURE=empty \
  "$SCRIPT_DIR/mock-ksef" >/dev/null 2>&1 || true

$COMPOSE up -d --build mock-ksef stub-sink-a stub-sink-b
$COMPOSE up -d --wait mock-ksef stub-sink-a stub-sink-b 2>/dev/null || true

# Override mock-ksef image to use empty fixture
COMPOSE_CMD="docker compose -f $SCRIPT_DIR/docker-compose.smoke.yml"
if FIXTURE_PATH=/fixtures/empty.json $COMPOSE_CMD up -d --build mock-ksef 2>/dev/null; then :; fi
$COMPOSE_CMD up -d --wait mock-ksef 2>/dev/null || true

if $COMPOSE_CMD run --rm ksef-downloader --year 2026 --month 4; then
  ok "Scenario 4: empty month exited 0"
else
  fail "Scenario 4: empty month non-zero exit"
fi

# ─── scenario 5: retention ──────────────────────────────────────────────────

info "Scenario 5: retention — directory with marker is deleted"
teardown
$COMPOSE up -d --build mock-ksef stub-sink-a stub-sink-b
$COMPOSE up -d --wait mock-ksef stub-sink-a stub-sink-b 2>/dev/null || true

# Pre-seed a January 2026 directory (old, with marker) in the inbox volume
$COMPOSE run --rm --no-deps -v smoke_inbox:/inbox ksef-downloader \
  sh -c "mkdir -p /inbox/2026/01 && echo dummy > /inbox/2026/01/REF.pdf && echo ts > /inbox/2026/01/.sink-a-synced" \
  2>/dev/null || true

# Run downloader for March (now=2026-03-01 is past Jan+10d retention)
if SMOKE_RETENTION_DAYS=10 SMOKE_EXPECTED_MARKERS=.sink-a-synced \
    $COMPOSE run --rm ksef-downloader --year 2026 --month 3; then
  ok "Scenario 5: downloader exited 0"
else
  fail "Scenario 5: downloader non-zero exit"
fi

assert_no_file "Scenario 5" "2026/01"

# ─── scenario 6: all sinks down ─────────────────────────────────────────────

info "Scenario 6: all sinks unreachable — downloader exits 1"
teardown
$COMPOSE up -d --build mock-ksef
$COMPOSE up -d --wait mock-ksef 2>/dev/null || true

if SMOKE_SINK_URLS=http://nowhere:8080 $COMPOSE run --rm ksef-downloader --year 2026 --month 4; then
  fail "Scenario 6: downloader should have exited 1 but exited 0"
else
  ok "Scenario 6: downloader exited 1 as expected"
fi

assert_file_exists "Scenario 6" "2026/04/received/20260401-RR-ABCDEF123456-20260401-1.pdf"

# ─── summary ────────────────────────────────────────────────────────────────

teardown

echo ""
echo "Smoke results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
