#!/usr/bin/env bash
# Packs one browser package together with the exact source it was built from:
#
#   <browser>-<branch>-<mode>-<version>.tar.gz
#   ├── extension/   chromium.zip  or  firefox-signed.xpi
#   └── source/      every committed file of this revision (what `git archive HEAD` gives)
#
# Usage: scripts/make-archive.sh <chromium|firefox> <development|release> <branch> <package>
#
#   branch    the branch the build was started from; characters other than letters,
#             digits, "." "_" "-" become "-" in the file name (feature/x -> feature-x)
#   package   the .zip (Chromium) or signed .xpi (Firefox) to put under extension/
#   version   read from manifests/<browser>.json
#
# The archive is written to dist/ (or $OUT_DIR) and its path is the only thing printed on
# stdout. Run it from a git checkout. Needs: bash, git, GNU tar, gzip.
#
# The source folder comes from git, not from the working tree, so it holds exactly the
# committed files: no build output, no untracked files, no credentials. The script also
# refuses to continue if a tracked file looks like a key, a token file or build output.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd -P)

usage() {
  echo "usage: scripts/make-archive.sh <chromium|firefox> <development|release> <branch> <package>" >&2
  exit 2
}

[ $# -eq 4 ] || usage
browser=$1 mode=$2 branch=$3 package=$4
case $package in /*) ;; *) package=$PWD/$package ;; esac

cd "$root"
# shellcheck source=scripts/lib.sh
. scripts/lib.sh

case $browser in
  chromium) packaged_as=chromium.zip ;;
  firefox) packaged_as=firefox-signed.xpi ;;
  *) usage ;;
esac
case $mode in
  development | release) ;;
  *) usage ;;
esac

[ -f "$package" ] || die "package not found: $package"
git rev-parse --verify --quiet HEAD >/dev/null || die "run this inside a git checkout that has at least one commit"

version=$(manifest_value "manifests/$browser.json" version)
[ -n "$version" ] || die "could not read \"version\" from manifests/$browser.json"
safe_branch=$(printf '%s' "$branch" | LC_ALL=C sed 's/[^A-Za-z0-9._-]/-/g' | cut -c1-80)
[ -n "$safe_branch" ] || die "the branch name is empty"

out_dir=${OUT_DIR:-dist}
archive="$out_dir/$browser-$safe_branch-$mode-$version.tar.gz"
epoch=$(source_epoch)

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/extension" "$stage/source"
cp "$package" "$stage/extension/$packaged_as"
git archive --format=tar HEAD | tar -x -C "$stage/source"

leaks=$(cd "$stage/source" && find . -type f \( \
  -name '.env' -o -name '.env.*' -o -name '.npmrc' -o -name '.web-extension-id' \
  -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' -o -name '*.jks' -o -name '*.keystore' \
  -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*.xpi' -o -name '*.crx' \
  -o -path '*/web-ext-artifacts/*' \) -print | LC_ALL=C sort)
[ -z "$leaks" ] || die "these tracked files look like secrets or build output; remove them from git first:
$leaks"

chmod -R u=rwX,go=rX "$stage" # modes must not depend on the umask of whoever runs this
mkdir -p "$out_dir"
LC_ALL=C tar --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner \
  -C "$stage" -cf - extension source | gzip -n -9 >"$archive"

echo "Packed $archive ($(wc -c <"$archive") bytes)" >&2
printf '%s\n' "$archive"
