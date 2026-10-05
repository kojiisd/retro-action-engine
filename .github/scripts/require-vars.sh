#!/usr/bin/env bash
# Fails the job when any of the named environment variables is empty.
# Usage: require-vars.sh NAME [NAME...]
# The workflows map GitHub repository variables (vars.*) to environment variables first.
set -euo pipefail

missing=()
for name in "$@"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  for name in "${missing[@]}"; do
    echo "::error::GitHub repository variable ${name} is not set. See infra/README.md."
  done
  exit 1
fi
echo "All required variables are set: $*"
