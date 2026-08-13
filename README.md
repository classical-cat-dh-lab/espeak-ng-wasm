# espeak-ng-wasm

Reproducible WebAssembly builds of [eSpeak NG](https://github.com/espeak-ng/espeak-ng)
for browser and PWA text-to-speech, with a minimal driver focused on **direct phoneme
(IPA) input**.

Maintained by the **Classical Cat Digital Humanities Lab**.

## Why this exists

eSpeak NG is a compact, offline, zero-marginal-cost formant synthesizer (GPLv3) with a
unique capability among small-footprint TTS engines: it accepts phoneme input directly
(`[[...]]` mnemonic mode), giving callers full control over the phonology. That makes it
ideal for language-teaching and philology tools where pronunciation must follow an
explicit, auditable transcription rather than a black-box language model.

However:

- The upstream repository ships an `emscripten/` port directory with documented build
  steps, but **no prebuilt WebAssembly releases**.
- The upstream JS glue layer dates from 2017 and relies on the deprecated
  `ScriptProcessorNode` API (tracked in upstream issue #1701).
- Existing community builds on npm are stale, unaudited, or lack a reproducible build
  pipeline.

This repository provides:

1. A **pinned, reproducible build pipeline** (local + CI) from upstream release tags to
   `.wasm` + `.data` artifacts.
2. A **minimal modern driver** (`espeak-wasm-driver.js`): Web Worker isolation, PCM
   retrieval via the C API, playback through `AudioBufferSourceNode` — no deprecated
   APIs.
3. A **trimmed data package**: phoneme synthesis tables only, no per-language
   dictionaries (phoneme-input mode bypasses them), targeting ≤ 4 MB total.
4. **Checksummed releases** (`sha256sums.txt`) so downstream projects can vendor
   artifacts verifiably.

## Status

Build spike complete and verified (2026-08-13): the full pipeline — pinned
upstream 1.52.0 + emsdk 6.0.6 → native data build → wasm cross-compile →
trimmed data pack → driver — runs green, and the wasm artifact synthesizes
speech sample-identical to the native build. Remaining before the v0.1.0 tag:
academic freeze of the Latin mapping table, CI workflow, and the full
acceptance suite ([BUILDING.md](BUILDING.md) §Acceptance criteria).

| File | Role |
|---|---|
| `build.sh` / `trim-data.sh` | The pipeline (single source of truth, local + CI) |
| `glue.c` | Minimal C glue between libespeak-ng and JS |
| `espeak-wasm-driver.js` | The driver — implements [INTERFACE.md](INTERFACE.md) |
| `mapping/la.json` | Latin IPA→mnemonic table (**DRAFT**, pending academic review) |
| `test/node-smoke.mjs` | Engine-level headless smoke test |
| `test/driver-smoke.mjs` | Driver-level contract test (mapping, stress, rate, errors) |
| `BUILDING.md` | Build instructions (as-built, incl. platform pitfalls) |
| `INTERFACE.md` | Stability contract for consumers |

## Usage

```js
import { init, synthesize, playIPA } from "./vendor/espeak-ng/espeak-wasm-driver.js";

await init({ wasmURL: "./vendor/espeak-ng/espeak-ng.wasm",
             dataURL: "./vendor/espeak-ng/espeak-ng.data" });

// One-call convenience: synthesize + play (first call needs a user gesture)
await playIPA("ˈar.ma wɪr.ˈʊŋ.kʷe ˈka.noː");   // arma virumque cano

// Or get raw PCM (22050 Hz, 16-bit signed, mono):
const { pcm, sampleRate, durationMs } = await synthesize("ˈka.noː", { rate: 120 });
```

The driver accepts IPA and maps it internally to eSpeak NG phoneme mnemonics; the
mapping table is versioned, explicit, and hard-fails on unmappable symbols (no silent
approximation). Full contract: [INTERFACE.md](INTERFACE.md).

## Verify

```sh
bash build.sh            # full pipeline (native + wasm + package), ~10 min
node test/node-smoke.mjs    # engine-level: PCM non-silent, rate 22050
node test/driver-smoke.mjs  # driver-level: mapping, stress, rate, error contract
```

## License and attribution

**GPLv3** — the build artifacts are derivative works of eSpeak NG. Corresponding
source: the pinned upstream tag (submodule reference in this repo) plus the build
scripts and glue code here.

This project stands on earlier emscripten ports by **Eitan Isaacson** (original eSpeak
port, 2015) and **Alberto Pettarin** (eSpeak NG adaptation, 2016, merged upstream).
