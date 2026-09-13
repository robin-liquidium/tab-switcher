#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 0 ]]; then
  echo 'Use SIGNING_IDENTITY for signing and script/release.py for notarization. See RELEASING.md.' >&2
  exit 2
fi
exec python3 "$(dirname "$0")/../script/package_app.py"
