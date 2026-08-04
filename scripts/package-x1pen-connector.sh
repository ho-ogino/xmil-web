#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
manifest="$repo_root/extension/manifest.json"
version=$(node -p "require(process.argv[1]).version" "$manifest")
output=${1:-"$repo_root/dist/x1pen-connector-$version.zip"}

case "$output" in
  /*) ;;
  *) output="$PWD/$output" ;;
esac

staging=$(mktemp -d "${TMPDIR:-/tmp}/x1pen-connector.XXXXXX")
trap 'rm -rf "$staging"' EXIT HUP INT TERM

mkdir -p "$staging/icons" "$(dirname -- "$output")"
for file in manifest.json popup.html popup.css popup.js service-worker.js; do
  cp "$repo_root/extension/$file" "$staging/$file"
done
for size in 16 32 48 128; do
  cp "$repo_root/extension/icons/icon-$size.png" "$staging/icons/icon-$size.png"
done
cp -R "$repo_root/extension/_locales" "$staging/_locales"

rm -f "$output"
(cd "$staging" && zip -q -X -r "$output" .)
printf 'Created %s\n' "$output"
