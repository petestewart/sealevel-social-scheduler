#!/usr/bin/env bash
# Fire the nightly Sealevel schedule post via GitHub repository_dispatch.
#
# Run this at ~7:00pm America/Los_Angeles from any scheduler (cron, systemd
# timer, cron-job.org). It is safe to run more than once per night — the
# workflow's posts/<date>.posted marker guarantees only one post per day.
#
# Requires a GitHub fine-grained personal access token with access to ONLY
# the petestewart/sealevel-social-scheduler repo and "Contents: Read and
# write" permission. Provide it one of two ways (never commit it anywhere):
#   1. Environment variable:  GH_DISPATCH_TOKEN=github_pat_... ./fire-nightly.sh
#   2. Token file (default ~/.config/sealevel/gh-token, chmod 600):
#      GH_DISPATCH_TOKEN_FILE=/path/to/token ./fire-nightly.sh
set -euo pipefail

REPO="petestewart/sealevel-social-scheduler"
TOKEN_FILE="${GH_DISPATCH_TOKEN_FILE:-$HOME/.config/sealevel/gh-token}"

TOKEN="${GH_DISPATCH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -r "$TOKEN_FILE" ]; then
  TOKEN=$(head -n1 "$TOKEN_FILE" | tr -d '[:space:]')
fi
if [ -z "$TOKEN" ]; then
  echo "ERROR: no token. Set GH_DISPATCH_TOKEN or put the PAT in $TOKEN_FILE" >&2
  exit 1
fi

http_code=$(curl -sS -o /tmp/sealevel-dispatch-response.txt -w '%{http_code}' \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO/dispatches" \
  -d '{"event_type":"nightly-post"}')

if [ "$http_code" = "204" ]; then
  echo "$(date -u +%FT%TZ) dispatched nightly-post OK"
else
  echo "ERROR: GitHub API returned HTTP $http_code" >&2
  cat /tmp/sealevel-dispatch-response.txt >&2
  exit 1
fi
