# shellcheck shell=bash
# Helpers shared by scripts/build.sh and scripts/make-archive.sh.
# Source this file from the project root; do not run it.

die() {
  echo "error: $*" >&2
  exit 1
}

# manifest_value FILE KEY
# Prints a top-level string value ("version", "version_name") from a manifest that keeps one key per line.
manifest_value() {
  sed -n "s/^[[:space:]]*\"$2\":[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$1" | head -n 1
}

# source_epoch
# The time stamped on every packaged file, so the same source always gives the same bytes.
# SOURCE_DATE_EPOCH wins, then the time of the last commit, then the archived epoch, then a fixed date.
source_epoch() {
  if [ -n "${SOURCE_DATE_EPOCH:-}" ]; then
    printf '%s\n' "$SOURCE_DATE_EPOCH"
  elif [ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$(pwd -P)" ] && git log -1 --format=%ct 2>/dev/null; then
    :
  elif [ -f .source-date-epoch ]; then
    local archived_epoch
    archived_epoch=$(cat .source-date-epoch)
    [[ "$archived_epoch" =~ ^[0-9]+$ ]] || die "invalid archived build epoch"
    printf '%s\n' "$archived_epoch"
  else
    printf '%s\n' 1767225600 # 2026-01-01 00:00:00 UTC
  fi
}

# secret_like_files
# Lists the files committed in HEAD whose names look like keys, tokens, credentials, environment files or
# build output, which must never travel in a source archive. One path per line; nothing when all is well.
# It judges names only (a heuristic, not a scanner), in any letter case.
secret_like_files() {
  git ls-tree -r -z --name-only HEAD | while IFS= read -r -d '' file; do
    case "/${file,,}" in
      */.env | */.env.* | */.npmrc | */.web-extension-id | */web-ext-artifacts/* \
        | *.pem | *.key | *.p12 | *.pfx | *.jks | *.keystore | */id_rsa* | */id_ed25519* | *.xpi | *.crx \
        | *token* | *secret* | *credential*)
        printf '%s\n' "$file"
        ;;
    esac
  done
}

# refuse_secret_like_files
# Stops the calling script when secret_like_files finds anything.
refuse_secret_like_files() {
  local found
  found=$(secret_like_files | LC_ALL=C sort)
  [ -z "$found" ] || die "these committed files look like secrets or build output; remove them from git first:
$found"
}
