# Project Status (STATUS.md)

> Snapshot for maintainers and contributors. Updated at each milestone.
> Current as of: 2026-08-15 (**v0.1.0 released 2026-08-13**).

## What works today

- **Build pipeline** (`bash build.sh`): pinned espeak-ng **1.52.0**
  (commit `4870adfa`) + emsdk **6.0.6** → native data build → wasm
  cross-compile → trimmed data pack → `dist/` artifacts + `manifest.json` +
  `sha256sums.txt`. Clean-run verified locally (macOS 26, Apple Silicon).
- **Artifacts**: `espeak-ng.wasm` 367 KB + `espeak-ng.data` 644 KB +
  `espeak-ng.js` 68 KB → **1.0 MB** total pre-gzip (acceptance: ≤ 4 MB).
- **Driver** (`espeak-wasm-driver.js`): implements INTERFACE.md §3 —
  `init` / `synthesize` / `playIPA` / `terminate`, IPA→mnemonic mapping with
  stress repositioning, hard-error semantics (`UnmappableSymbolError`),
  per-call rate/pitch. v0.1.x runs on the main thread; Worker isolation is
  planned for v0.2 with no API change.
- **Verification**: `node test/node-smoke.mjs` and `node
  test/driver-smoke.mjs` both green; wasm output matches the native build
  sample-for-sample (n=7231, RMS=4237 on the reference input `[[arma]]`).
- **Released**: `v0.1.0` — tag + GitHub Release (artifacts + checksums),
  archived on Zenodo with DOI `10.5281/zenodo.21917624`.

## Known gaps after v0.1.0

1. **Latin mapping table is a DRAFT** — `mapping/la.json` carries
   `_meta.openReviewItems` (r-sound convention, short-vowel laxness notation,
   ui diphthong, aspiration handling) pending academic sign-off
   (INTERFACE.md §5 review gate). Freeze targeted for v0.1.1.
2. **No CI workflow yet** — v0.1.0 was built, tested, and released locally;
   acceptance criterion #1 (clean-machine reproducibility, CI checksums
   matching local) is therefore still untested. A minimal GitHub Actions
   workflow (clean build + smoke tests + checksum comparison) is planned
   for v0.1.1.
3. **Functional acceptance coverage is thin** — current coverage is the two
   smoke tests; the ≥ 20 gold-standard IPA string suite (acceptance #2)
   is in preparation.
4. **Known issues from a post-release audit (2026-08-14)** — under
   maintainer review; fixes targeted for v0.1.1:
   - The v0.1.0 Release layout (`la.json` at the asset root) does not match
     the driver's default mapping path (`./mapping/la.json`), so default
     vendoring per the README example fails at `init()` with a fetch error.
     Workaround: pass `mappingURL` or an inline `mapping` explicitly.
   - `init()` is not concurrency-safe and its lifecycle transition is not
     atomic (concurrent or interrupted init can leave inconsistent state).
   - `build.sh` does not enforce the pinned emsdk version — the manifest
     `emsdk` field is informational only.
   - `build.sh` does not guard against dirty or stale upstream checkouts
     (commit hash match does not imply a clean tree or fresh native data).
   - Absolute build paths are embedded in the generated loader, so
     bit-for-bit reproducibility does not hold across checkout directories
     (runtime relocation is unaffected).
   - Contract-valid input (500 IPA characters at rate 80) can exceed the
     fixed 60-second PCM buffer and fail with `SynthesisError`.
   - `sha256sums.txt` / `manifest.json` cover only the three engine
     artifacts, not the driver or the mapping table.
   - The mapping contract marks `kind` optional, but the driver requires it
     for stress placement — custom mappings that omit it silently lose
     stress marks.
   - `UnmappableSymbolError.position` miscounts after whitespace runs.

## Roadmap

- **v0.1.1**: audit fixes (above), CI workflow, expanded functional
  acceptance, mapping table freeze, complete checksum/manifest coverage.
- **v0.2**: Web Worker isolation (no API change); streaming evaluation.
- **Per-language packs**: additional voices are a few KB each
  (e.g. `lang/grk/grc` for Ancient Greek already exists upstream) — extend
  `trim-data.sh`, add a mapping table, pass `voice` at `init()`.
- **Extended phoneme inventories** (e.g. PIE laryngeals): not in upstream's
  phoneme table; would need either mapping-level approximations or a
  phsource extension (heavier; deferred).

## Hard-won build lessons (all encoded in BUILDING.md)

Read BUILDING.md before touching the pipeline — it is the as-built record.
Highlights: bootstrap order (`autogen.sh` BEFORE `autoreconf`), ucd-tools is
source-vendored (no separate build, no submodule), `--disable-shared`
(macOS 26 ld), musl `wchar.h` vs compat-shim macros (`-include wchar.h`),
two-step emcc/em++ link (C++ runtime + C export linkage), and the
`espeakPHONEMES` flag requirement (without it `[[...]]` silently degrades to
the dictionary path).

## Verification commands

```sh
bash build.sh                 # full pipeline, ~10 min
node test/node-smoke.mjs      # engine level
node test/driver-smoke.mjs    # driver level
```
