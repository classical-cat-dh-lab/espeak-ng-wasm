#!/usr/bin/env bash
# build.sh — reproducible eSpeak NG → WebAssembly pipeline. See BUILDING.md.
#
# Usage: bash build.sh [native|smoke|wasm|package|all]   (default: all)
#   native   clone/pin/bootstrap/configure/make upstream + native smoke tests
#   smoke    native smoke tests only (Latin voice, [[...]] mode, --ipa)
#   wasm     cross-compile (ucd-tools + libespeak-ng), trim data, link wasm
#   package  full runtime set into dist/ + manifest.json + sha256sums.txt
#   all      native → wasm → package
#
# Environment:
#   EMSDK_DIR   emsdk location (default: $HOME/developer/emsdk)
#   FORCE=1     rebuild the native tree even if the cache stamp matches
#
# Long builds: run via `nohup bash build.sh > build/logs/build.log 2>&1 &`
# and tail the log (see BUILDING.md §Operational discipline).
set -euo pipefail

# --- Pinned inputs (recorded into dist/manifest.json) -----------------------
ESPEAK_TAG="1.52.0"
ESPEAK_COMMIT="4870adfa25b1a32b4361592f1be8a40337c58d6c"
EMSDK_VERSION="6.0.6"

# --- Paths ------------------------------------------------------------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM="$ROOT/espeak-ng"          # native tree (gitignored)
WASM_TREE="$ROOT/build/tree-wasm"   # cross-compile copy (gitignored)
TRIMMED="$ROOT/build/espeak-ng-data-trimmed"
DIST="$ROOT/dist"
SMOKE="$ROOT/build/smoke"
STAMP="$ROOT/build/.native-cache.stamp"
EMSDK_DIR="${EMSDK_DIR:-$HOME/developer/emsdk}"

# --disable-shared: we only ever consume the static libespeak-ng.a, and the
# macOS 26 linker rejects libtool's -undefined dynamic_lookup for
# shared-cache-eligible dylibs. Harmless on CI (ubuntu-latest).
CONFIGURE_FLAGS="--prefix=/usr --without-async --without-mbrola --without-sonic --disable-shared"

JOBS="$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

log() { printf '\n=== build.sh: %s ===\n' "$*"; }

# H-03: fail-closed emsdk pin enforcement. emsdk_env.sh activates whatever
# version happens to be current; building with the wrong one would silently
# change the toolchain behind the pinned constant. We do NOT auto-install
# the SDK — mismatch is a maintainer action, reported with the fix command.
EMCC_VERSION_LINE=""
verify_emsdk() {
    [ -x "$EMSDK_DIR/emsdk" ] || {
        echo "emsdk not found at $EMSDK_DIR (set EMSDK_DIR)" >&2; exit 1; }
    # shellcheck disable=SC1091
    source "$EMSDK_DIR/emsdk_env.sh" >/dev/null
    EMCC_VERSION_LINE="$(emcc --version | head -1)"
    local ver
    ver="$(printf '%s\n' "$EMCC_VERSION_LINE" | sed -E 's/^emcc \([^)]*\) ([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
    if [ "$ver" != "$EMSDK_VERSION" ]; then
        echo "emsdk pin violation: build.sh pins $EMSDK_VERSION but the active emcc reports:" >&2
        echo "  $EMCC_VERSION_LINE" >&2
        echo "fix: (cd \"$EMSDK_DIR\" && ./emsdk install $EMSDK_VERSION && ./emsdk activate $EMSDK_VERSION)" >&2
        exit 1
    fi
}

# H-04: native-cache validity identity — the pinned commit, the configure
# flags, and the measured native toolchain. A rebuild is triggered by any
# drift, not merely by missing artifacts.
native_toolchain_id() {
    {
        echo "commit: $ESPEAK_COMMIT"
        echo "flags: $CONFIGURE_FLAGS"
        echo "cc: $(cc --version 2>/dev/null | head -1)"
        echo "autoconf: $(autoconf --version | head -1)"
        echo "automake: $(automake --version | head -1)"
        echo "make: $(make --version | head -1)"
    }
}

stage_native() {
    if [ ! -d "$UPSTREAM/.git" ]; then
        log "clone upstream"
        git clone https://github.com/espeak-ng/espeak-ng "$UPSTREAM"
    fi
    git -C "$UPSTREAM" checkout -q "$ESPEAK_TAG"
    actual="$(git -C "$UPSTREAM" rev-parse HEAD)"
    [ "$actual" = "$ESPEAK_COMMIT" ] || {
        echo "pin mismatch: expected $ESPEAK_COMMIT, got $actual" >&2; exit 1; }
    # H-04: refuse to build on a dirty upstream tree — local edits or stale
    # checkouts would silently poison native data provenance. Report and
    # stop; never `git clean` a tree the maintainer may be reusing.
    dirty="$(git -C "$UPSTREAM" status --porcelain)"
    if [ -n "$dirty" ]; then
        echo "upstream tree is dirty — refusing to build:" >&2
        printf '%s\n' "$dirty" >&2
        echo "resolve manually (commit/stash/restore), then re-run" >&2
        exit 1
    fi
    git -C "$UPSTREAM" submodule update --init   # ucd-tools is a submodule

    if [ "${FORCE:-0}" != "1" ] && [ -x "$UPSTREAM/src/espeak-ng" ] \
       && [ -f "$UPSTREAM/espeak-ng-data/phondata" ] && [ -f "$STAMP" ] \
       && [ "$(cat "$STAMP")" = "$(native_toolchain_id)" ]; then
        log "native cache valid (commit+flags+toolchain stamp match; FORCE=1 to rebuild)"
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
        mkdir -p "$ROOT/build"
        native_toolchain_id > "$STAMP"
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
    verify_emsdk

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
    # H-05: run the link from inside dist/ with a RELATIVE output path. An
    # absolute -o path is embedded in the generated loader and breaks
    # bit-for-bit reproducibility across checkout directories.
    cd "$DIST"
    em++ -O3 -sWASM=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH=1 \
        -sENVIRONMENT=web,node \
        --preload-file "$TRIMMED@/espeak-ng-data" \
        -sEXPORTED_FUNCTIONS=_espeakng_init,_espeakng_set_voice,_espeakng_synthesize,_espeakng_pcm,_espeakng_pcm_len,_espeakng_sample_rate,_espeakng_set_rate,_espeakng_set_pitch,_espeakng_terminate \
        -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,HEAP16 \
        "$ROOT/build/glue.o" "$WASM_TREE/src/.libs/libespeak-ng.a" \
        -o espeak-ng.js
    ls -la "$DIST"
}

stage_package() {
    log "package: full runtime set + manifest.json + sha256sums.txt"
    verify_emsdk
    # M-02/L-03: the release ships the complete runtime set, not just the
    # engine triple — the driver, the mapping table (flat as ./la.json, the
    # path the driver resolves by default), and LICENSE (GPLv3 discipline).
    cp "$ROOT/espeak-wasm-driver.js" "$DIST/espeak-wasm-driver.js"
    cp "$ROOT/mapping/la.json" "$DIST/la.json"
    cp "$ROOT/LICENSE" "$DIST/LICENSE"
    cd "$DIST"
    local_files="espeak-ng.js espeak-ng.wasm espeak-ng.data espeak-wasm-driver.js la.json LICENSE"
    shasum -a 256 $local_files > sha256sums.txt
    sha() { grep " $1\$" sha256sums.txt | cut -d' ' -f1; }
    # M-04: mappingVersion is read from the mapping JSON itself (single
    # source of truth — no hardcoded constant to drift out of sync).
    mapping_version="$(sed -n 's/.*"mappingVersion": *"\([^"]*\)".*/\1/p' la.json | head -1)"
    [ -n "$mapping_version" ] || {
        echo "cannot read mappingVersion from mapping/la.json" >&2; exit 1; }
    # M-06: record the measured native toolchain. No fixed build container
    # yet — cross-platform SHA equivalence is judged by the CI-vs-local
    # checksum comparison introduced with the v0.1.1 workflow.
    cat > manifest.json <<EOF
{
  "upstream": {
    "repo": "https://github.com/espeak-ng/espeak-ng",
    "tag": "$ESPEAK_TAG",
    "commit": "$ESPEAK_COMMIT"
  },
  "emsdk": "$EMSDK_VERSION",
  "emscripten": "$EMCC_VERSION_LINE",
  "mappingVersion": "$mapping_version",
  "toolchain": {
    "cc": "$(cc --version 2>/dev/null | head -1)",
    "autoconf": "$(autoconf --version | head -1)",
    "automake": "$(automake --version | head -1)",
    "make": "$(make --version | head -1)"
  },
  "artifacts": {
    "espeak-ng.js":           { "sha256": "$(sha espeak-ng.js)" },
    "espeak-ng.wasm":         { "sha256": "$(sha espeak-ng.wasm)" },
    "espeak-ng.data":         { "sha256": "$(sha espeak-ng.data)" },
    "espeak-wasm-driver.js":  { "sha256": "$(sha espeak-wasm-driver.js)" },
    "la.json":                { "sha256": "$(sha la.json)" },
    "LICENSE":                { "sha256": "$(sha LICENSE)" }
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
