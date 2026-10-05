#!/usr/bin/env bash
# Uploads a built site to the bucket.
#
# Usage:
#   sync-site.sh preview    <dist-dir> <bucket> <pr-number>   # -> s3://<bucket>/pr-<n>/
#   sync-site.sh production <dist-dir> <bucket>               # -> s3://<bucket>/ (keeps pr-*)
#
# Cache policy (ADR-0014): hashed files under assets/ are immutable; everything else
# (index.html, pack data, service worker) is no-cache.
# Order: new assets first, then the rest, then stale assets are removed, so a page never
# references an asset that was already deleted.
set -euo pipefail

mode="${1:-}"
dist="${2:-}"
bucket="${3:-}"

usage() {
  echo "usage: $0 preview <dist-dir> <bucket> <pr-number> | production <dist-dir> <bucket>" >&2
  exit 2
}

[[ -n "$dist" && -n "$bucket" ]] || usage
[[ -d "$dist" ]] || { echo "dist directory not found: $dist" >&2; exit 1; }

excludes=()
case "$mode" in
  preview)
    pr="${4:-}"
    [[ "$pr" =~ ^[0-9]+$ ]] || { echo "pr-number must be numeric, got '$pr'" >&2; exit 2; }
    dest="s3://${bucket}/pr-${pr}"
    ;;
  production)
    [[ $# -eq 3 ]] || usage
    dest="s3://${bucket}"
    # Never touch PR previews or the deny-check area from a production deploy.
    excludes=(--exclude 'pr-*' --exclude '_deny-check/*')
    ;;
  *)
    usage
    ;;
esac

immutable='public, max-age=31536000, immutable'
revalidate='no-cache'

if [[ -d "$dist/assets" ]]; then
  echo "Uploading assets to ${dest}/assets/"
  aws s3 sync "$dist/assets" "${dest}/assets" --cache-control "$immutable" --no-progress
fi

echo "Uploading the rest to ${dest}/"
aws s3 sync "$dist" "${dest}/" --delete --exclude 'assets/*' "${excludes[@]}" \
  --cache-control "$revalidate" --no-progress

if [[ -d "$dist/assets" ]]; then
  echo "Removing stale assets from ${dest}/assets/"
  aws s3 sync "$dist/assets" "${dest}/assets" --delete --cache-control "$immutable" --no-progress
fi
