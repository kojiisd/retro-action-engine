#!/usr/bin/env bash
# Verifies that the preview role cannot write outside pr-* (ADR-0014).
# Run it with the preview role's credentials. It tries one put-object outside pr-* and
# expects AccessDenied. If the write succeeds, the role is too broad: the object is removed
# and the job fails.
#
# Usage: check-preview-deny.sh <bucket> <key>
set -euo pipefail

bucket="${1:?bucket required}"
key="${2:?key required}"

case "$key" in
  pr-*) echo "::error::the deny check key must be outside pr-*, got '$key'"; exit 2 ;;
esac

body="$(mktemp)"
echo "deny check from ${GITHUB_REPOSITORY:-local} run ${GITHUB_RUN_ID:-0}" > "$body"

if output="$(aws s3api put-object --bucket "$bucket" --key "$key" --body "$body" 2>&1)"; then
  echo "::error::put-object to s3://${bucket}/${key} succeeded. The preview role can write outside pr-*."
  aws s3api delete-object --bucket "$bucket" --key "$key" || true
  exit 1
fi

if grep -q 'AccessDenied' <<<"$output"; then
  echo "OK: put-object to s3://${bucket}/${key} was denied (AccessDenied), as expected."
else
  echo "::error::put-object failed for an unexpected reason: ${output}"
  exit 1
fi
