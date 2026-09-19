# Project Status (STATUS.md)

> Snapshot for maintainers and contributors. Updated at each milestone.
> Runtime baseline: **v0.1.1 released 2026-08-16**.
> Maintenance documentation reconciled: 2026-09-19; no new runtime release.

## What works today

- **Build pipeline** (`bash build.sh`): pinned espeak-ng **1.52.0**
  (commit `4870adfa`) + emsdk **6.0.6** → native data build → wasm
  cross-compile → trimmed data pack → `dist/` artifacts + `manifest.json` +
  `sha256sums.txt`. Fail-closed guards: upstream pin check, dirty-tree check,
  native cache stamp (commit + configure flags + native toolchain), enforced
  emsdk version check. Clean-run verified locally (macOS 26, Apple Silicon)
  and in CI (ubuntu-latest).
- **Artifacts**: `espeak-ng.wasm` 364 KB + `espeak-ng.data` 644 KB +
  `espeak-ng.js` 68 KB → **1.0 MB** total pre-gzip (acceptance: ≤ 4 MB).
  Releases ship the full runtime set: engine triple + driver + `la.json` +
  `LICENSE` + `manifest.json` + `sha256sums.txt` (checksums and manifest
  cover all six runtime files).
- **Driver** (`espeak-wasm-driver.js`): implements INTERFACE.md §3 —
  `init` / `synthesize` / `playIPA` / `terminate`, IPA→mnemonic mapping with
  stress repositioning, hard-error semantics (`UnmappableSymbolError` with
  codepoint-accurate positions), per-call rate/pitch, atomic single-flight
  init lifecycle, validated mapping tables (`kind` required). Default mapping
  resolution matches the flat Release layout (`./la.json` next to the driver;
  Node reads it via the filesystem). v0.1.x runs on the main thread; Worker
  isolation is a possible future improvement, not a scheduled v0.2 commitment.
- **Glue** (`glue.c`): dynamic-growth PCM buffer (60 s initial, doubling,
  300 s hard cap) — the full 500-character contract limit synthesizes at any
  rate (500 × "a" @ rate 80 = 78.7 s, verified against the native glue build:
  sample count identical).
- **Mapping table**: `mapping/la.json` **frozen at 0.1.0** — academic sign-off
  2026-08-15 (INTERFACE.md §5 gate). `manifest.json` reads `mappingVersion`
  from the table itself.
- **Verification**: `node test/node-smoke.mjs`, `node test/driver-smoke.mjs`
  (19 checks incl. init-lifecycle races, kind validation, position spans,
  the 500-character boundary), `node test/release-layout-smoke.mjs`, and
  `node test/acceptance.mjs` (22 cases: Aeneid I.1–7 gold standard +
  mapping-coverage derived cases, every la.json rule exercised) — all green;
  wasm output matches the native build sample-for-sample on the reference
  inputs (e.g. `[[arma]]`: n=7231, RMS=4237).
- **CI** (`.github/workflows/build.yml`): clean build + all four test suites
  on ubuntu-latest, a second build in a different absolute checkout path, and
  a byte-identical `sha256sums.txt` comparison between the two. Tag pushes
  (`v*`) publish the GitHub Release from the CI-verified dist set.
- **Released**: `v0.1.1` — tag + GitHub Release (full runtime set +
  checksums). Zenodo archiving: `v0.1.0` DOI `10.5281/zenodo.21917624`;
  the v0.1.1 release mints a new version DOI under the same concept DOI.

## Known gaps / notes after v0.1.1

1. **Legacy-API reinitialization can report a stale sample rate** on a reused
   WASM module (audit L-02) — unreachable via the stable driver API
   (terminate → init creates a fresh module). Revisit only if a concrete consumer
   need or separately scoped lifecycle change makes that legacy path relevant.
2. **Cross-platform checksum equivalence (CI ubuntu vs local macOS) is
   compared at release time**, not enforced as a gate yet (audit M-06,
   deliberate): the measured native toolchain is recorded in `manifest.json`
   so any divergence is diagnosable. If a mismatch ever shows up, the
   fallback is a pinned build container. First reading (v0.1.1, 2026-08-16):
   CI ubuntu-24.04 artifact vs local macOS arm64 dist — `sha256sums.txt`
   **byte-identical** across all eight files.
3. **Very long single-call utterances (> ~100 phonemes, > ~16 s of audio)
   show platform-dependent prosody realization** — same phonemes and timing
   (sample counts match to within a handful of samples), different pitch
   contour rendering between native arm64 and wasm32 builds, and sensitivity
   to memory layout (observed 2026-08-16 while verifying the 500-character
   boundary: at/below 100 phonemes all builds are sample-for-sample
   identical). This is upstream engine behavior on pathological input, not a
   pipeline defect; the intended usage (INTERFACE.md §3: split longer input
   by phrase) stays far below the threshold. Candidate for an upstream
   report; not investigated further here.
4. **Human ear-check** (acceptance #3: 5–10 items incl. Aeneid I.1–7) remains
   a maintainer activity per release; the programmatic suite covers items
   1–2 and 5.

## Roadmap

Maintain the released build and stable driver for demonstrated consumer needs.
Worker isolation, lifecycle redesign, streaming and additional language packs have
no committed version or delivery schedule. A future change needs a concrete use
case, bounded scope and compatibility verification.

Extended phoneme inventories may require an explicit approximation or upstream
phoneme work. They are not promised by the current Latin release.

## Hard-won build lessons (all encoded in BUILDING.md)

Read BUILDING.md before touching the pipeline — it is the as-built record.
Highlights: bootstrap order (`autogen.sh` BEFORE `autoreconf`), ucd-tools is
source-vendored (no separate build, no submodule), `--disable-shared`
(macOS 26 ld), musl `wchar.h` vs compat-shim macros (`-include wchar.h`),
two-step emcc/em++ link (C++ runtime + C export linkage), the
`espeakPHONEMES` flag requirement (without it `[[...]]` silently degrades to
the dictionary path), relative output paths from inside `dist/` (absolute
paths leak into the loader and break reproducibility), and fail-closed
pin/tree/cache guards.

## Verification commands

```sh
bash build.sh                        # full pipeline, ~10 min
node test/node-smoke.mjs             # engine level
node test/driver-smoke.mjs           # driver level (19 checks)
node test/release-layout-smoke.mjs   # packaged driver, flat Release layout
node test/acceptance.mjs             # 22-case functional acceptance
```
