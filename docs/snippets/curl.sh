#!/usr/bin/env bash
# Data Nexus Traffic — check your key and the server contract with curl.
#
#   NEXUS_SECRET_KEY=nx_sk_… bash curl.sh
#   NEXUS_URL=http://localhost:8080/traffic NEXUS_SECRET_KEY=nx_sk_… bash curl.sh   # local stack
#
# Steps: 1) verify the key  2) dry run (writes nothing)  3) send one event  4) resend the SAME event
# → expect "accepted":1 on step 3 and "duplicates":1 on step 4 (eventId makes resends idempotent).
# Contract: https://nexus.libas.in/traffic/api/docs/
set -euo pipefail

NEXUS_URL="${NEXUS_URL:-https://nexus.libas.in/traffic}"
: "${NEXUS_SECRET_KEY:?set NEXUS_SECRET_KEY to your nx_sk_… key}"
API="${NEXUS_URL%/}/api"

# A random RFC 4122 v4 uuid without extra tools.
uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then uuidgen | tr '[:upper:]' '[:lower:]'
  else python3 -c 'import uuid; print(uuid.uuid4())'
  fi
}

# UTC ISO-8601 with milliseconds (portable: GNU and BSD date).
now() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }

# Print the body, then the HTTP status on its own line.
call() { curl -sS -w '\nHTTP %{http_code}\n' "$@"; echo; }

EVENT_ID="$(uuid)"
OCCURRED_AT="$(now)"

# The batch: re-stamp sentAt on every attempt, but keep eventId + occurredAt IDENTICAL.
batch() {
  cat <<JSON
{
  "sentAt": "$(now)",
  "sdk": { "name": "curl", "version": "1.0.0" },
  "events": [
    {
      "eventId": "${EVENT_ID}",
      "occurredAt": "${OCCURRED_AT}",
      "method": "GET",
      "path": "/my-app/api/v1/stores/1042",
      "routeTemplate": "/my-app/api/v1/stores/:id",
      "status": 200,
      "durationMs": 41.7,
      "ip": "203.0.113.24",
      "userEmail": "someone@libas.in"
    }
  ]
}
JSON
}

send() {
  call -X POST "$1" \
    -H 'Content-Type: application/json' \
    -H "X-Nexus-Key: ${NEXUS_SECRET_KEY}" \
    --data-binary "$(batch)"
}

echo '1) verify the key → 200 {"app":…,"keyKind":"secret",…}'
call "${API}/v1/ingest/verify" -H "X-Nexus-Key: ${NEXUS_SECRET_KEY}"

echo '2) dry run → 202 {…,"dryRun":true} (validated and enriched, nothing is stored)'
send "${API}/v1/ingest/server?dryRun=1"

echo '3) send one event → 202 {"accepted":1,"duplicates":0,…}'
send "${API}/v1/ingest/server"

echo '4) resend the SAME event → 202 {"accepted":0,"duplicates":1,…}'
send "${API}/v1/ingest/server"
