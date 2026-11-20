#!/usr/bin/env bash
# Builds the two browser extensions from src/ + manifests/ + the license.
#
#   chromium/   unpacked build for Chrome, Edge, Brave and other Chromium browsers
#   firefox/    unpacked build for Firefox (load it, or sign it: see README.md)
#   dist/       double-tap-to-refresh-chromium-<label>.zip
#               double-tap-to-refresh-firefox-<label>.xpi   (not signed)
#
# Usage: scripts/build.sh [chromium|firefox|all]        (default: all)
# Needs: bash, cp, find, sort, touch, zip (Termux: pkg install zip).
#
# Each build folder gets src/, its own manifest as manifest.json, and the license from the
# project root saved as LICENSE.txt (a .txt opens as plain text in a browser tab, and the
# options page links to it). The folders and dist/ are generated: never edit or commit them.
#
# Same source, same bytes: files are stamped with one fixed time and zipped in sorted order.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
. scripts/lib.sh

usage() {
  echo "usage: scripts/build.sh [chromium|firefox|all]" >&2
  exit 2
}

[ $# -le 1 ] || usage
case "${1:-all}" in
  all) targets=(chromium firefox) ;;
  chromium | firefox) targets=("$1") ;;
  *) usage ;;
esac

license=
for candidate in LICENSE.md LICENSE LICENSE.txt; do
  if [ -f "$candidate" ]; then
    license=$candidate
    break
  fi
done
[ -n "$license" ] || die "the license is missing: put LICENSE.md (or LICENSE) in the project root"

epoch=$(source_epoch)
export TZ=UTC LC_ALL=C # zip stores local time and sorts by locale
mkdir -p dist

for target in "${targets[@]}"; do
  manifest="manifests/$target.json"
  [ -f "$manifest" ] || die "$manifest is missing"

  version=$(manifest_value "$manifest" version)
  [ -n "$version" ] || die "could not read \"version\" from $manifest"
  label=$(manifest_value "$manifest" version_name)
  label=$(printf '%s' "${label:-$version}" | sed 's/[^A-Za-z0-9._+-]/-/g')

  case $target in
    chromium) extension=zip ;;
    firefox) extension=xpi ;;
  esac
  package="dist/double-tap-to-refresh-$target-$label.$extension"

  rm -rf "$target"
  rm -f dist/double-tap-to-refresh-"$target"-*
  mkdir "$target"
  cp -R src/. "$target/"
  cp "$manifest" "$target/manifest.json"
  cp "$license" "$target/LICENSE.txt" # the GPL asks for the license text to travel with every copy
  find "$target" \( -name '.DS_Store' -o -name 'Thumbs.db' -o -name '*~' \) -delete

  # Fixed modes and dates, so rebuilding unchanged source gives an identical file.
  find "$target" -type d -exec chmod 755 {} +
  find "$target" -type f -exec chmod 644 {} +
  find "$target" -exec touch -d "@$epoch" {} +
  (cd "$target" && find . -type f | sed 's|^\./||' | sort | zip -q -X -D -9 "../$package" -@)

  [ "$(manifest_value "$target/manifest.json" version)" = "$version" ] || die "$target/manifest.json lost its version"
  echo "Built $target $label (version $version): $target/ and $package ($(wc -c <"$package") bytes)"
done
