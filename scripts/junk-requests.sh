#!/usr/bin/env bash
set -uo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <base-url>" >&2
  exit 2
fi

endpoint="${1%/}/api/discord/interactions"
now="$(date +%s)"
fake_signature="$(printf 'a%.0s' {1..128})"
failures=0

expect() {
  local name="$1" expected="$2"
  shift 2
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$endpoint" "$@")"
  if [[ "$status" == "$expected" ]]; then
    printf 'PASS  %-40s %s\n' "$name" "$status"
  else
    printf 'FAIL  %-40s got %s, expected %s\n' "$name" "$status" "$expected"
    failures=$((failures + 1))
  fi
}

expect "no signature headers" 401 -H 'Content-Type: application/json' -d '{"type":1}'
expect "invalid signature" 401 -H 'Content-Type: application/json' \
  -H "X-Signature-Ed25519: $fake_signature" -H "X-Signature-Timestamp: $now" -d '{"type":1}'
expect "malformed signature" 401 -H 'Content-Type: application/json' \
  -H 'X-Signature-Ed25519: not-hex' -H "X-Signature-Timestamp: $now" -d '{"type":1}'
expect "stale timestamp with junk signature" 401 -H 'Content-Type: application/json' \
  -H "X-Signature-Ed25519: $fake_signature" -H 'X-Signature-Timestamp: 1000000000' -d '{"type":1}'
expect "empty body" 401 -H "X-Signature-Ed25519: $fake_signature" -H "X-Signature-Timestamp: $now"
expect "non-JSON body" 401 -H 'Content-Type: text/plain' \
  -H "X-Signature-Ed25519: $fake_signature" -H "X-Signature-Timestamp: $now" -d 'hello'

if [[ $failures -gt 0 ]]; then
  echo "$failures check(s) failed." >&2
  exit 1
fi
echo "All forged requests were rejected."
