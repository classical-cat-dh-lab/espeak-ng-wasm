# Driver Interface Contract (INTERFACE.md)

> Status: **v0.1.1** — frozen at the v0.1.0 tag (2026-08-13); v0.1.1 (2026-08-16)
> applies patch-level errata and clarifications only (see §8 Changelog — no API
> shape change). Changes after freeze follow semver: breaking changes bump the
> major version.
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

Vendored from a GitHub Release of this repo (verify against `sha256sums.txt`).
The Release is a **flat** file set — all files side by side, no directories:

| File | Role |
|---|---|
| `espeak-ng.wasm` | Compiled engine (Emscripten) |
| `espeak-ng.data` | Trimmed phoneme/intonation data package |
| `espeak-ng.js` | Emscripten loader (ES module, MODULARIZE) |
| `espeak-wasm-driver.js` | Driver implementing this contract |
| `la.json` | Latin IPA→mnemonic mapping table (default mapping; §5) |
| `LICENSE` | GPLv3 — must ship alongside the vendored files (§7) |
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
  mappingURL?: string,    // override IPA→mnemonic mapping table (default:
                          // ./la.json alongside the driver — the flat Release
                          // layout)
  mapping?: object,       // inline parsed mapping table (alternative to
                          // mappingURL — for tests, bundlers, non-fetch envs)
  voice?: string,         // engine voice for phoneme realization (default "la";
                          // the voice must exist in the data package)
}
```

- Idempotent and single-flight: concurrent calls share one in-flight promise; a
  call after success is a no-op. Initialization is atomic — state is committed
  only after the mapping table validates, the module instantiates, and the
  voice is set; a failed init tears down its half-built module and leaves the
  driver re-initializable. Must resolve before any other call.
- v0.1.x loads the engine on the **main thread** (a verse synthesizes in
  ~10–50 ms on the recorded short-verse checks). Web Worker isolation is
  a possible separately scoped improvement, not a scheduled release commitment.

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
- Utterance length limit: PCM is buffered up to a hard cap of 300 s of audio;
  exceeding it rejects with `SynthesisError`. (The 500-character input limit at
  the slowest rate stays far below this cap.)

### `playIPA(ipa, options?) → Promise<void>`

- `synthesize()` + playback through `AudioBufferSourceNode` on a shared
  `AudioContext`. Resolves when playback ends.
- Browser autoplay policy: the first call must be triggered from a user gesture;
  the driver creates/resumes the `AudioContext` on that call. Later calls are
  unrestricted.

### `terminate() → void`

- Frees engine resources (wasm memory and the PCM buffer). The driver is
  re-initializable afterwards. Calling `terminate()` while an `init()` is in
  flight makes that init reject rather than commit over the terminated
  lifecycle.

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
  `position` is the **codepoint index in the NFC-normalized input**, whitespace
  spans included (an astral codepoint counts as one position, not two UTF-16
  units). The driver never substitutes an approximate phoneme. Callers should
  surface this as a data bug, not a runtime failure to hide.

## 5. IPA → mnemonic mapping table

- Single JSON file, versioned (`mappingVersion` in `manifest.json`, read from
  the table's own `_meta.mappingVersion`; bump on any change). Shape: ordered
  list of `{ ipa, mnemonic, kind, note? }` rules, longest-match first for
  multi-codepoint sequences (ties, affricates, gemination).
- `kind` is **required** and must be `"vowel" | "diphthong" | "consonant"` —
  the driver needs it to attach pending stress marks to vowel mnemonics (§4).
  `init()` validates every rule and rejects a table with a missing or invalid
  `kind` with `InitError`. (Erratum: v0.1.0 documented `kind` as optional,
  but stress placement has always depended on it — a rule omitting it silently
  lost stress. See §8.)
- Publication statuses: a table may ship either as **reviewed** (signed off by a
  domain reviewer — the academic gate below) or as a **draft** (version string
  carries a `-draft` suffix, and the table's `_meta.status` says so). The
  sign-off gate constrains declaring a version reviewed/frozen, not shipping a
  clearly-marked draft.
- Academic review gate: declaring a mapping version reviewed requires sign-off
  by a domain reviewer. Review target = phoneme-level sound↔symbol
  correspondence against upstream `phsource/phonemes` and the Latin phoneme
  definitions.
- Callers with their own phoneme inventory (e.g., a future Ancient Greek project)
  pass `mappingURL` at `init()` — no fork of the driver needed.

## 6. Errors

| Error | Meaning |
|---|---|
| `InitError` | wasm/data/mapping fetch or compile failure (check URLs, MIME `application/wasm`, COOP/COEP not required); invalid mapping table (§5) |
| `UnmappableSymbolError` | §4 hard-error semantics |
| `SynthesisError` | engine returned an error code (e.g., malformed input after mapping), or the utterance exceeded the 300 s PCM hard cap |
| `DriverStateError` | call before `init()` / after `terminate()` |

## 7. Deployment notes for callers

- Serve `.wasm` with MIME type `application/wasm` (enables streaming compilation).
- Vendor the **flat** Release set (§2) and keep `la.json` alongside
  `espeak-wasm-driver.js` — that is where the default `mappingURL` resolves.
  Callers bundling differently pass `mappingURL` or an inline `mapping`.
- Node.js callers (tests, scripts): pass `wasmURL`/`dataURL` as plain
  filesystem paths, not `file://` URLs — the Emscripten loader feeds them to
  `readFileSync`. `loaderURL` accepts either. `mappingURL` follows the same
  convention: in Node the driver reads it (and the default `./la.json`) via the
  filesystem; plain paths, `file:` URLs, and `http(s)://` URLs all work.
  See `test/driver-smoke.mjs`.
- Pre-cache all artifacts in the PWA Service Worker (versioned URLs) for offline use;
  total footprint ≤ 4 MB (pre-gzip) is a release acceptance criterion.
- v0.1.x runs on the main thread: PCM is copied out of wasm memory into a JS
  `Int16Array` per call. No `SharedArrayBuffer`, no cross-origin isolation
  requirement. (A future Worker boundary would require separate buffer-ownership and
  compatibility verification; no version is scheduled.)
- GPLv3: vendoring these artifacts makes phoneme-synthesis functionality a derivative
  work of eSpeak NG — keep the LICENSE file alongside the vendored files and credit
  upstream in your About page.

## 8. Changelog

- **v0.1.1** (2026-08-16) — patch-level errata and clarifications, no API shape
  change:
  - Default `mappingURL` corrected to `./la.json` alongside the driver, matching
    the flat Release layout and the §7 vendoring instructions (the v0.1.0
    implementation defaulted to `./mapping/la.json`, which 404s on the Release
    layout). Node.js mapping loading now uses the filesystem, per §7.
  - `init()` lifecycle hardened: single-flight concurrent init, atomic state
    commit, terminate-during-init rejection, module cleanup on failure.
  - `kind` documented as required (erratum — §5); `init()` validates it.
  - `UnmappableSymbolError.position` specified as a codepoint index including
    whitespace spans (the v0.1.0 implementation miscounted across whitespace).
  - PCM buffering: dynamic growth with a documented 300 s hard cap, replacing
    an undocumented 60 s ceiling that contract-valid input (500 characters at
    rate 80) could exceed.
  - `terminate()` and §7 wording corrected to the main-thread reality (the
    v0.1.0 text incorrectly described a Worker; v0.1.x uses the main thread).
- **v0.1.0** (2026-08-13) — initial freeze.
