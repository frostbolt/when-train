#!/usr/bin/env bash
# Fetch /api/arrivals/card and preview it the way Finder Quick Look will render it.
#
# Usage:
#   scripts/test-card.sh                       # default coords (Bay Pkwy)
#   scripts/test-card.sh <lat> <lng>           # custom coords
#   scripts/test-card.sh bay-pkwy              # named preset
#   scripts/test-card.sh --open                # open in TextEdit instead of Quick Look
#   HOST=https://staging.example scripts/test-card.sh   # override host

set -euo pipefail

HOST="${HOST:-http://localhost:3001}"

# A few preset coords so you can sanity-check different station types.
# (macOS ships bash 3.2 — no assoc arrays — so we use a case statement.)
preset_coords() {
  case "$1" in
    bay-pkwy)        echo "40.610452250244656,-73.98024824248395" ;;  # N line
    times-sq)        echo "40.7559,-73.9870" ;;                       # busy hub
    grand-central)   echo "40.7527,-73.9772" ;;                       # mid-Manhattan
    middle-of-water) echo "40.5,-74.05" ;;                            # should 404
    bad-coords)      echo "abc,xyz" ;;                                # should 400
    *) return 1 ;;
  esac
}
PRESET_NAMES="bay-pkwy times-sq grand-central middle-of-water bad-coords"

mode="quicklook"
args=()
for a in "$@"; do
  case "$a" in
    --open) mode="textedit" ;;
    --raw)  mode="raw" ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) args+=("$a") ;;
  esac
done

if [[ ${#args[@]} -eq 0 ]]; then
  coords=$(preset_coords bay-pkwy)
elif [[ ${#args[@]} -eq 1 ]]; then
  if ! coords=$(preset_coords "${args[0]}"); then
    echo "unknown preset '${args[0]}'. available: $PRESET_NAMES" >&2
    exit 1
  fi
else
  coords="${args[0]},${args[1]}"
fi

lat="${coords%,*}"
lng="${coords#*,}"
url="${HOST}/api/arrivals/card?lat=${lat}&lng=${lng}"
out="$(mktemp -t arrivals-card.XXXXXX).rtf"

echo "→ GET $url"
http_code=$(curl -sS -o "$out" -w "%{http_code}" \
  -D /tmp/arrivals-card.headers "$url")

echo "← HTTP $http_code"
content_type=$(awk -F': ' 'tolower($1)=="content-type"{print $2}' /tmp/arrivals-card.headers | tr -d '\r')
echo "← Content-Type: ${content_type:-<missing>}"
echo "← Bytes: $(wc -c < "$out" | tr -d ' ')"

if [[ "$http_code" != "200" ]]; then
  echo "--- body ---"
  cat "$out"
  echo
  exit 1
fi

# Sanity checks on the RTF body.
if ! head -c 6 "$out" | grep -q '^{\\rtf'; then
  echo "✗ response does not start with {\\rtf — not valid RTF" >&2
  exit 1
fi
if ! grep -q '}$' "$out"; then
  echo "✗ response does not end with } — RTF likely truncated" >&2
  exit 1
fi
echo "✓ looks like well-formed RTF"

case "$mode" in
  raw)      cat "$out" ;;
  textedit) open -a TextEdit "$out" ;;
  quicklook)
    # qlmanage -p is what Finder uses for Quick Look. Closes when you ⌘-W.
    echo "→ opening Quick Look preview (⌘-W to close)"
    qlmanage -p "$out" >/dev/null 2>&1 ;;
esac
