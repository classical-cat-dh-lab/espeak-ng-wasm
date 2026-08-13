#!/usr/bin/env bash
# trim-data.sh SRC_DIR DST_DIR — scripted espeak-ng-data trim. Never manual.
#
# IPA/mnemonic ([[...]]) synthesis bypasses dictionaries, so we keep only the
# phoneme-synthesis core plus the Latin voice definition:
#
#   phondata, phonindex, phontab   phoneme synthesis core (required)
#   intonations                    intonation curves (required)
#   lang/itc/la                    Latin voice (engine requires a voice at init)
#
# Deliberately excluded:
#   *_dict              dictionary lookup is never used in phoneme mode
#   voices/!v, voices/mb  la references no variants; no mbrola
#   phondata-manifest   build-time artifact, not read at runtime
#   all other lang/ voices
#
# Layout note: espeak-ng 1.52 moved language voices from voices/<code> to
# lang/<family>/<code>; there is no voices/default file in this release.
set -euo pipefail

src="${1:?usage: trim-data.sh SRC_DIR DST_DIR}"
dst="${2:?usage: trim-data.sh SRC_DIR DST_DIR}"

for f in phondata phonindex phontab intonations lang/itc/la; do
    [ -f "$src/$f" ] || { echo "trim-data: missing expected file: $src/$f" >&2; exit 1; }
done

rm -rf "$dst"
mkdir -p "$dst/lang/itc"
cp "$src/phondata" "$src/phonindex" "$src/phontab" "$src/intonations" "$dst/"
cp "$src/lang/itc/la" "$dst/lang/itc/la"

before=$(du -sm "$src" | cut -f1)
after=$(du -sk "$dst" | cut -f1)
echo "trim-data: ${before} MB -> ${after} KB ($dst)"
