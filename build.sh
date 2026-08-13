#!/usr/bin/env bash
# build.sh — reproducible eSpeak NG → WebAssembly pipeline. See BUILDING.md.
#
# Usage: bash build.sh [native|smoke|wasm|package|all]   (default: all)
#   native   clone/pin/bootstrap/configure/make upstream + native smoke tests
#   smoke    native smoke tests only (Latin voice, [[...]] mode, --ipa)
#   wasm     cross-compile (ucd-tools + libespeak-ng), trim data, link wasm
#   package  manifest.json + sha256sums.txt over dist/
#   all      native → wasm → package
#
# Environment:
#   EMSDK_DIR   emsdk location (default: $HOME/developer/emsdk)
#   FORCE=1     rebuild the native tree even if artifacts exist
#
# Long builds: run via `nohup bash build.sh > build/logs/build.log 2>&1 &`
# and tail the log (see BUILDING.md §Operational discipline).
set -euo pipefail

# --- Pinned inputs (recorded into dist/manifest.json) -----------------------
ESPEAK_TAG="1.52.0"
ESPEAK_COMMIT="4870adfa25b1a32b4361592f1be8a40337c58d6c"
EMSDK_VERSION="6.0.6"
MAPPING_VERSION="none"   # IPA→mnemonic table ships after academic review

# --- Paths ------------------------------------------------------------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM="$ROOT/espeak-ng"          # native tree (gitignored)
WASM_TREE="$ROOT/build/tree-wasm"   # cross-compile copy (gitignored)
TRIMMED="$ROOT/build/espeak-ng-data-trimmed"
DIST="$ROOT/dist"
SMOKE="$ROOT/build/smoke"
EMSDK_DIR="${EMSDK_DIR:-$HOME/developer/emsdk}"

# --disable-shared: we only ever consume the static libespeak-ng.a, and the
# macOS 26 linker rejects libtool's -undefined dynamic_lookup for
# shared-cache-eligible dylibs. Harmless on CI (ubuntu-latest).
CONFIGURE_FLAGS="--prefix=/usr --without-async --without-mbrola --without-sonic --disable-shared"

JOBS="$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

log() { printf '\n=== build.sh: %s ===\n' "$*"; }

stage_native() {
    if [ ! -d "$UPSTREAM/.git" ]; then
        log "clone upstream"
        git clone https://github.com/espeak-ng/espeak-ng "$UPSTREAM"
    fi
    git -C "$UPSTREAM" checkout -q "$ESPEAK_TAG"
    actual="$(git -C "$UPSTREAM" rev-parse HEAD)"
    [ "$actual" = "$ESPEAK_COMMIT" ] || {
        echo "pin mismatch: expected $ESPEAK_COMMIT, got $actual" >&2; exit 1; }
    git -C "$UPSTREAM" submodule update --init   # ucd-tools is a submodule

    if [ "${FORCE:-0}" != "1" ] && [ -x "$UPSTREAM/src/espeak-ng" ] \
       && [ -f "$UPSTREAM/espeak-ng-data/phondata" ]; then
        log "native tree already built (FORCE=1 to rebuild)"
    else
        log "bootstrap + native build"
        cd "$UPSTREAM"
        # autogen.sh FIRST: it creates AUTHORS / NEWS / README that automake
        # requires. autoreconf -fvi afterwards force-regenerates everything
        # as copies (no host-autotools symlinks — the ChromeOS port lesson).
        ./autogen.sh
        autoreconf -fvi
        ./configure $CONFIGURE_FLAGS
        make -j"$JOBS"
    fi
    stage_smoke
}

stage_smoke() {
    log "native smoke tests"
    cd "$UPSTREAM"
    export ESPEAK_DATA_PATH="$UPSTREAM"
    mkdir -p "$SMOKE"
    src/espeak-ng -v la -w "$SMOKE/la-text.wav" "arma virumque cano"
    src/espeak-ng -v la -w "$SMOKE/la-phon.wav" "[[arma]]"
    src/espeak-ng -v la --ipa "arma virumque cano" > "$SMOKE/la-ipa.txt"
    echo "smoke IPA: $(cat "$SMOKE/la-ipa.txt")"
}

stage_wasm() {
    [ -f "$UPSTREAM/espeak-ng-data/phondata" ] || {
        echo "native data missing — run: bash build.sh native" >&2; exit 1; }
    [ -x "$EMSDK_DIR/emsdk" ] || {
        echo "emsdk not found at $EMSDK_DIR (set EMSDK_DIR)" >&2; exit 1; }
    # shellcheck disable=SC1091
    source "$EMSDK_DIR/emsdk_env.sh"

    log "prepare wasm tree (copy + distclean)"
    rm -rf "$WASM_TREE"
    mkdir -p "$(dirname "$WASM_TREE")"
    cp -a "$UPSTREAM" "$WASM_TREE"
    cd "$WASM_TREE"
    make distclean >/dev/null 2>&1 || true

    # No separate ucd-tools build: since 1.50 its sources are vendored into
    # libespeak-ng's Makefile.am (src/ucd-tools/src/*.c in
    # libespeak_ng_la_SOURCES); its own autotools project is never invoked.
    log "cross-compile libespeak-ng (ucd-tools sources vendored in)"
    emconfigure ./configure $CONFIGURE_FLAGS
    # -include wchar.h works around a musl-specific header conflict:
    # src/include/compat/wctype.h unconditionally #defines isw* to ucd_*;
    # musl's wchar.h (unlike glibc/Darwin) declares isw* itself, so any TU
    # that includes wctype.h before wchar.h gets macro-mangled musl
    # declarations conflicting with ucd.h. Force-including wchar.h first
    # sets musl's header guard before the macros are ever defined.
    # Zero upstream patches; the ucd routing semantics are preserved.
    emmake make src/libespeak-ng.la CFLAGS="-O2 -include wchar.h"

    log "trim data"
    bash "$ROOT/trim-data.sh" "$UPSTREAM/espeak-ng-data" "$TRIMMED"

    log "link wasm"
    mkdir -p "$DIST"
    # Two-step link: libespeak-ng.a contains C++ objects (sized operator
    # delete etc.), so the link must run under em++ to pull in the C++
    # runtime. But em++ would compile glue.c AS C++ (g++ semantics) and
    # name-mangle the exports — so glue.c is compiled separately with emcc
    # (C linkage preserved) and only the link uses em++.
    emcc -O3 -I"$WASM_TREE/src/include" -c "$ROOT/glue.c" -o "$ROOT/build/glue.o"
    em++ -O3 -sWASM=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH=1 \
        -sENVIRONMENT=web,node \
        --preload-file "$TRIMMED@/espeak-ng-data" \
        -sEXPORTED_FUNCTIONS=_espeakng_init,_espeakng_set_voice,_espeakng_synthesize,_espeakng_pcm,_espeakng_pcm_len,_espeakng_sample_rate,_espeakng_set_rate,_espeakng_set_pitch,_espeakng_terminate \
        -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,HEAP16 \
        "$ROOT/build/glue.o" "$WASM_TREE/src/.libs/libespeak-ng.a" \
        -o "$DIST/espeak-ng.js"
    ls -la "$DIST"
}

stage_package() {
    log "package: manifest.json + sha256sums.txt"
    source "$EMSDK_DIR/emsdk_env.sh"
    cd "$DIST"
    emcc_ver="$(emcc --version | head -1)"
    shasum -a 256 espeak-ng.js espeak-ng.wasm espeak-ng.data > sha256sums.txt
    sha() { grep " $1\$" sha256sums.txt | cut -d' ' -f1; }
    cat > manifest.json <<EOF
{
  "upstream": {
    "repo": "https://github.com/espeak-ng/espeak-ng",
    "tag": "$ESPEAK_TAG",
    "commit": "$ESPEAK_COMMIT"
  },
  "emsdk": "$EMSDK_VERSION",
  "emscripten": "$emcc_ver",
  "mappingVersion": "$MAPPING_VERSION",
  "artifacts": {
    "espeak-ng.js":   { "sha256": "$(sha espeak-ng.js)" },
    "espeak-ng.wasm": { "sha256": "$(sha espeak-ng.wasm)" },
    "espeak-ng.data": { "sha256": "$(sha espeak-ng.data)" }
  }
}
EOF
    cat manifest.json
}

case "${1:-all}" in
    native)  stage_native ;;
    smoke)   stage_smoke ;;
    wasm)    stage_wasm ;;
    package) stage_package ;;
    all)     stage_native; stage_wasm; stage_package ;;
    *) echo "usage: bash build.sh [native|smoke|wasm|package|all]" >&2; exit 2 ;;
esac

log "done (${1:-all})"
