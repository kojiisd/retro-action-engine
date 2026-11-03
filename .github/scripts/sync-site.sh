#!/usr/bin/env bash
# Uploads a built site to the bucket.
#
# Usage:
#   sync-site.sh preview    <dist-dir> <bucket> <pr-number>   # -> s3://<bucket>/pr-<n>/
#   sync-site.sh production <dist-dir> <bucket>               # -> s3://<bucket>/ (keeps pr-*)
#
# Site layout (site.json): the gallery at the root, each game under play/<slug>/.
# Cache policy (ADR-0014): Vite's hashed files are immutable. They live in assets/ (gallery) and
# play/<slug>/assets/ (games). Everything else (index.html, images, pack data, service worker) is
# no-cache.
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

# AWS CLI filters match the path relative to the sync root; "*" also matches "/".
hashed=(--exclude '*' --include 'assets/*' --include 'play/*/assets/*')
not_hashed=(--exclude 'assets/*' --exclude 'play/*/assets/*')

echo "Uploading hashed assets to ${dest}/"
aws s3 sync "$dist" "${dest}/" "${hashed[@]}" --cache-control "$immutable" --no-progress

echo "Uploading the rest to ${dest}/"
aws s3 sync "$dist" "${dest}/" --delete "${not_hashed[@]}" "${excludes[@]}" \
  --cache-control "$revalidate" --no-progress

echo "Removing stale hashed assets from ${dest}/"
aws s3 sync "$dist" "${dest}/" --delete "${hashed[@]}" --cache-control "$immutable" --no-progress
