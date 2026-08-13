# Project Status (STATUS.md)

> Snapshot for maintainers and contributors. Updated at each milestone.
> Current as of: 2026-08-13 (build spike complete).

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

## Gap list to v0.1.0

1. **Latin mapping table freeze** — `mapping/la.json` is a DRAFT; the
   `_meta.openReviewItems` list (r-sound convention, short-vowel laxness
   notation, ui diphthong, aspiration handling) awaits academic sign-off
   (INTERFACE.md §5 review gate).
2. **CI workflow** — GitHub Actions ubuntu-latest running the same
   `build.sh`; acceptance criterion #1 (clean-machine reproducibility,
   checksums match local) is untested until this exists.
3. **Functional acceptance** — ≥ 20 gold-standard IPA strings through the
   driver with programmatic non-silence/duration checks (acceptance #2);
   current coverage is the two smoke tests.
4. **Release mechanics** — tag `v0.1.0` → GitHub Release with artifacts +
   checksums → Zenodo DOI (auto-on-release via the GitHub integration).

## Roadmap beyond v0.1.0

- **v0.2**: Web Worker isolation (no API change); streaming evaluation.
- **Per-language packs**: additional voices are a few KB each
  (e.g. `lang/grk/grc` for Ancient Greek already exists upstream) — extend
  `trim-data.sh`, add a mapping table, pass `voice` at `init()`.
- **Extended phoneme inventories** (e.g. PIE laryngeals): not in upstream's
  phoneme table; would need either mapping-level approximations or a
  phsource extension (heavier; deferred).

## Hard-won build lessons (all encoded in BUILDING.md)

Read BUILDING.md before touching the pipeline — it is the as-built record.
Highlights: bootstrap order (`autogen.sh` BEFORE `autoreconf`), submodule
init, `--disable-shared` (macOS 26 ld), ucd-tools is source-vendored (no
separate build), musl `wchar.h` vs compat-shim macros (`-include wchar.h`),
two-step emcc/em++ link (C++ runtime + C export linkage), and the
`espeakPHONEMES` flag requirement (without it `[[...]]` silently degrades to
the dictionary path).

## Verification commands

```sh
bash build.sh                 # full pipeline, ~10 min
node test/node-smoke.mjs      # engine level
node test/driver-smoke.mjs    # driver level
```
