#!/usr/bin/env bash
# Assembles the two ready-to-load extensions from src/ + manifests/ + LICENSE:
#   chromium/  load unpacked in Chrome, Edge, Brave and other Chromium browsers
#   firefox/   load as a temporary add-on, or package it (see README)
# and zips them into dist/. Needs: bash, cp, zip (Termux: pkg install zip).
set -euo pipefail
cd "$(dirname "$0")/.."

# `version` is the number the browsers compare (digits and dots only). Chromium's
# manifest may also carry a `version_name` such as "0.1.0-beta"; that label is
# used for the file names in dist/ (it falls back to `version` when absent).
manifest_value() {
  sed -n "s/^[[:space:]]*\"$1\":[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" manifests/chromium.json | head -n 1
}
version=$(manifest_value version)
[ -n "$version" ] || { echo "could not read the version from manifests/chromium.json" >&2; exit 1; }
label=$(manifest_value version_name)
label=${label:-$version}
[ -f LICENSE ] || { echo "LICENSE is missing" >&2; exit 1; }

rm -rf chromium firefox dist
mkdir -p dist

for target in chromium firefox; do
  mkdir -p "$target"
  cp -R src/. "$target/"
  cp "manifests/$target.json" "$target/manifest.json"
  cp LICENSE "$target/LICENSE"   # the GPL asks for the license text to travel with every copy
done

# -X drops extra file attributes, -D leaves out directory entries: a plain, portable zip.
(cd chromium && zip -qrXD "../dist/double-tap-to-refresh-chromium-$label.zip" .)
(cd firefox  && zip -qrXD "../dist/double-tap-to-refresh-firefox-$label.xpi" .)

echo "Built $label (manifest version $version):"
ls -1 dist | sed 's/^/  dist\//'
