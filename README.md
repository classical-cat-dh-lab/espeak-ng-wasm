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

Under construction — first release pending. See
[BUILDING.md](BUILDING.md) for the build pipeline and
[INTERFACE.md](INTERFACE.md) for the driver API contract (stable before v0.1.0).

## Usage (preview)

```js
import { init, playIPA } from "./vendor/espeak-ng/espeak-wasm-driver.js";

await init({ wasmURL: "./vendor/espeak-ng/espeak-ng.wasm",
             dataURL: "./vendor/espeak-ng/espeak-ng.data" });
await playIPA("ˈar.ma wɪr.ˈʊŋ.kʷe ˈka.noː");   // Latin: arma virumque cano
```

The driver accepts IPA and maps it internally to eSpeak NG phoneme mnemonics; the
mapping table is versioned, explicit, and hard-fails on unmappable symbols (no silent
approximation). Full contract: [INTERFACE.md](INTERFACE.md).

## License and attribution

**GPLv3** — the build artifacts are derivative works of eSpeak NG. Corresponding
source: the pinned upstream tag (submodule reference in this repo) plus the build
scripts and glue code here.

This project stands on earlier emscripten ports by **Eitan Isaacson** (original eSpeak
port, 2015) and **Alberto Pettarin** (eSpeak NG adaptation, 2016, merged upstream).
