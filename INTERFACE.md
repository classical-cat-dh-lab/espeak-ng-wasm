# Driver Interface Contract (INTERFACE.md)

> Status: **v0.1.0** — frozen at the v0.1.0 tag (2026-08-13). Changes after freeze
> follow semver: breaking changes bump the major version.
> Audience: any project embedding the artifacts (Porphyrii, dictionary tooling, future
> Ancient Greek projects). This contract is the only integration surface; everything
> else in the repo is implementation detail.

## 1. What the driver is (and is not)

The driver turns an **IPA transcription into speech audio**, fully offline, in the
browser. It is language-agnostic: it performs **no** orthography-to-phoneme conversion,
no dictionary lookup, no language rules. Callers own the phonology; the driver owns the
acoustics.

Non-goals: SSML, word-level language rules, streaming long-form reading, voice
selection UI.

## 2. Artifacts consumed by the caller

Vendored from a GitHub Release of this repo (verify against `sha256sums.txt`):

| File | Role |
|---|---|
| `espeak-ng.wasm` | Compiled engine (Emscripten) |
| `espeak-ng.data` | Trimmed phoneme/intonation data package |
| `espeak-ng.js` | Emscripten loader (ES module, MODULARIZE) |
| `espeak-wasm-driver.js` | Driver implementing this contract |
| `manifest.json` | Upstream tag/commit, Emscripten version, mapping-table version, build SHA-256s |

## 3. API

```js
import { init, synthesize, playIPA, terminate } from "./espeak-wasm-driver.js";
```

### `init(options) → Promise<void>`

```ts
options = {
  wasmURL: string,        // URL of espeak-ng.wasm
  dataURL: string,        // URL of espeak-ng.data
  loaderURL?: string,     // URL of espeak-ng.js (default: alongside driver)
  mappingURL?: string,    // override IPA→mnemonic mapping table (default: bundled)
  mapping?: object,       // inline parsed mapping table (alternative to
                          // mappingURL — for tests, bundlers, non-fetch envs)
  voice?: string,         // engine voice for phoneme realization (default "la";
                          // the voice must exist in the data package)
}
```

- Idempotent; second call is a no-op. Must resolve before any other call.
- v0.1.x loads the engine on the **main thread** (a verse synthesizes in
  ~10–50 ms, imperceptible behind a user gesture). Web Worker isolation is
  planned for v0.2 with **no API change**.

### `synthesize(ipa, options?) → Promise<SynthesisResult>`

```ts
SynthesisResult = {
  pcm: Int16Array,        // signed 16-bit little-endian mono samples
  sampleRate: 22050,      // constant in v0.x
  durationMs: number,
}
options = {
  rate?: number,          // words-per-minute scale, 80–450, default 175
  pitch?: number,         // 0–99, default 50
}
```

- Whole-utterance synthesis: resolves only after the full PCM buffer is ready.
- Input length limit: 500 IPA characters per call (split longer input by phrase).

### `playIPA(ipa, options?) → Promise<void>`

- `synthesize()` + playback through `AudioBufferSourceNode` on a shared
  `AudioContext`. Resolves when playback ends.
- Browser autoplay policy: the first call must be triggered from a user gesture;
  the driver creates/resumes the `AudioContext` on that call. Later calls are
  unrestricted.

### `terminate() → void`

- Frees the Worker and wasm memory. The driver is re-initializable afterwards.

## 4. Input contract (IPA)

- Encoding: UTF-8, **NFC-normalized** by the driver before processing.
- Suprasegmentals understood: `ˈ` primary stress, `ˌ` secondary stress, `.` syllable
  boundary. Stress is never inferred — unmarked input is synthesized unstressed.
- Stress placement convention: IPA marks stress before the syllable ONSET;
  espeak mnemonics want the mark before the stressed VOWEL. The driver holds
  the mark pending and emits it onto the next vowel/diphthong mnemonic.
- `.` syllable boundaries are accepted and dropped — the engine syllabifies
  phoneme strings internally.
- Whitespace separates words; everything else is treated as phoneme symbols.
- **Hard-error semantics**: any symbol (or symbol sequence) with no entry in the
  mapping table rejects the call with `UnmappableSymbolError { symbol, position }`.
  The driver never substitutes an approximate phoneme. Callers should surface this
  as a data bug, not a runtime failure to hide.

## 5. IPA → mnemonic mapping table

- Single JSON file, versioned (`mappingVersion` in `manifest.json`; bump on any
  change). Shape: ordered list of `{ ipa, mnemonic, kind?, note? }` rules,
  longest-match first for multi-codepoint sequences (ties, affricates,
  gemination). `kind` is `"vowel" | "diphthong" | "consonant"` — the driver
  needs it to attach pending stress marks to vowel mnemonics (§4).
- Academic review gate: the table is signed off by a domain reviewer before each
  mapping version ships. Review target = phoneme-level sound↔symbol correspondence
  against upstream `phsource/phonemes` and the Latin phoneme definitions.
- Callers with their own phoneme inventory (e.g., a future Ancient Greek project)
  pass `mappingURL` at `init()` — no fork of the driver needed.

## 6. Errors

| Error | Meaning |
|---|---|
| `InitError` | wasm/data fetch or compile failure (check URLs, MIME `application/wasm`, COOP/COEP not required) |
| `UnmappableSymbolError` | §4 hard-error semantics |
| `SynthesisError` | engine returned an error code (e.g., malformed input after mapping) |
| `DriverStateError` | call before `init()` / after `terminate()` |

## 7. Deployment notes for callers

- Serve `.wasm` with MIME type `application/wasm` (enables streaming compilation).
- Node.js callers (tests, scripts): pass `wasmURL`/`dataURL` as plain
  filesystem paths, not `file://` URLs — the Emscripten loader feeds them to
  `readFileSync`. `loaderURL` accepts either. See `test/driver-smoke.mjs`.
- Pre-cache all artifacts in the PWA Service Worker (versioned URLs) for offline use;
  total footprint ≤ 4 MB (pre-gzip) is a release acceptance criterion.
- No `SharedArrayBuffer`, no cross-origin isolation requirement in v0.x (PCM crosses
  Worker→main via transferable `ArrayBuffer`).
- GPLv3: vendoring these artifacts makes phoneme-synthesis functionality a derivative
  work of eSpeak NG — keep the LICENSE file alongside the vendored files and credit
  upstream in your About page.
