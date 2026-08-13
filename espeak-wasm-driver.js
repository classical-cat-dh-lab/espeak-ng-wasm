/*
 * espeak-wasm-driver.js — IPA → speech driver for the espeak-ng-wasm artifacts.
 *
 * Implements the contract in INTERFACE.md §3 (v0.1.0). Language-agnostic: no
 * orthography-to-phoneme conversion, no dictionary lookup. Callers own the
 * phonology (IPA in); the driver owns the acoustics (PCM out).
 *
 * v0.1.x loads the engine on the MAIN THREAD (synthesis of a verse takes
 * ~10–50 ms — imperceptible behind a user gesture). Web Worker isolation
 * lands in v0.2 with no API change.
 *
 * Usage:
 *   import { init, synthesize, playIPA, terminate } from "./espeak-wasm-driver.js";
 *   await init({ wasmURL: ".../espeak-ng.wasm", dataURL: ".../espeak-ng.data" });
 *   await playIPA("ˈar.ma wɪr.ˈʊŋ.kʷe ˈka.noː");
 */

const DEFAULTS = { rate: 175, pitch: 50 };   // INTERFACE.md §3
const MAX_INPUT_CHARS = 500;                 // INTERFACE.md §3
const SAMPLE_RATE = 22050;                   // INTERFACE.md §3 (constant in v0.x)

/* ---------------------------------------------------------------- errors */

export class InitError extends Error {
    constructor(message) { super(message); this.name = 'InitError'; }
}
export class UnmappableSymbolError extends Error {
    constructor(symbol, position) {
        super(`no mapping for symbol ${JSON.stringify(symbol)} at position ${position}`);
        this.name = 'UnmappableSymbolError';
        this.symbol = symbol;
        this.position = position;
    }
}
export class SynthesisError extends Error {
    constructor(message) { super(message); this.name = 'SynthesisError'; }
}
export class DriverStateError extends Error {
    constructor(message) { super(message); this.name = 'DriverStateError'; }
}

/* ----------------------------------------------------------------- state */

let _M = null;        // Emscripten module instance
let _rules = null;    // mapping rules, pre-sorted longest-first
let _state = 'new';   // new | ready | terminated
let _audioCtx = null; // shared AudioContext (created on first playIPA)

/* --------------------------------------------------------- IPA → mnemonic
 *
 * Longest-match over the rule list. Suprasegmentals are structural, handled
 * here rather than via the table:
 *   ˈ / ˌ  stress — espeak wants the mark BEFORE THE VOWEL of the stressed
 *          syllable (k'ano), IPA places it before the syllable ONSET
 *          ('ka.no:). We hold it pending and emit it just before the next
 *          vowel/diphthong mnemonic.
 *   .      syllable boundary — dropped; espeak syllabifies phoneme strings
 *          itself (accepted but unused in [[...]] input).
 */
function mapToMnemonics(text) {
    const words = text.split(/\s+/).filter(Boolean);
    const out = [];
    let charPos = 0; // codepoint offset in the NFC'd input, for error reporting
    for (const word of words) {
        const chars = [...word];
        let i = 0;
        let pendingStress = null;
        while (i < chars.length) {
            const ch = chars[i];
            if (ch === 'ˈ') { pendingStress = "'"; i++; charPos++; continue; }
            if (ch === 'ˌ') { pendingStress = ','; i++; charPos++; continue; }
            if (ch === '.') { i++; charPos++; continue; }
            let hit = null;
            for (const r of _rules) {           // pre-sorted longest-first
                if (r._len <= (hit ? hit._len : 0)) continue;
                let ok = true;
                for (let k = 0; k < r._cps.length; k++) {
                    if (chars[i + k] !== r._cps[k]) { ok = false; break; }
                }
                if (ok) hit = r;
            }
            if (!hit) throw new UnmappableSymbolError(ch, charPos);
            if (pendingStress && (hit.kind === 'vowel' || hit.kind === 'diphthong')) {
                out.push(pendingStress);
                pendingStress = null;
            }
            out.push(hit.mnemonic);
            i += hit._len;
            charPos += hit._len;
        }
        // A trailing pending stress (invalid IPA) is dropped silently; valid
        // input always has a vowel after the stress mark.
        out.push(' ');
        charPos += 1; // the whitespace consumed by split
    }
    return out.join('').trim();
}

/* -------------------------------------------------------------------- API */

/**
 * init(options) → Promise<void>   (INTERFACE.md §3)
 * Idempotent. options:
 *   wasmURL, dataURL   required — artifact URLs
 *   loaderURL          default: espeak-ng.js alongside this driver
 *   mappingURL         default: mapping/la.json alongside this driver (fetch)
 *   mapping            inline parsed mapping object (alternative to mappingURL
 *                      — for tests, bundlers, non-fetch environments)
 *   voice              default "la" — engine voice for phoneme realization
 */
export async function init(options) {
    if (_state === 'ready') return;
    if (!options || !options.wasmURL || !options.dataURL) {
        throw new InitError('init: wasmURL and dataURL are required');
    }
    try {
        let mapping = options.mapping;
        if (!mapping) {
            const url = options.mappingURL
                ?? new URL('./mapping/la.json', import.meta.url);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
            mapping = await res.json();
        }
        _rules = [...mapping.rules];
        for (const r of _rules) {
            r._cps = [...r.ipa];        // codepoints
            r._len = r._cps.length;
        }
        _rules.sort((a, b) => b._len - a._len); // longest-match first

        const loaderURL = options.loaderURL
            ?? new URL('./espeak-ng.js', import.meta.url);
        const { default: createModule } = await import(/* webpackIgnore: true */ loaderURL);
        _M = await createModule({
            locateFile: (file) =>
                file.endsWith('.wasm') ? options.wasmURL :
                file.endsWith('.data') ? options.dataURL : file,
            // The engine tries to load <voice>_dict as a SetVoice side effect;
            // the trimmed data package deliberately ships no dictionaries
            // (phoneme mode never consults them), so that one warning is
            // benign and filtered. Everything else reaches stderr as usual.
            printErr: (m) => {
                if (!/Can't read dictionary file/.test(m)) console.error(m);
            },
        });
        const sr = _M.ccall('espeakng_init', 'number', ['string'], ['/']);
        if (sr !== SAMPLE_RATE) {
            throw new Error(`engine init returned sample rate ${sr}, expected ${SAMPLE_RATE}`);
        }
        const voice = options.voice ?? 'la';
        if (_M.ccall('espeakng_set_voice', 'number', ['string'], [voice]) !== 0) {
            throw new Error(`voice "${voice}" not present in data package`);
        }
        _state = 'ready';
    } catch (e) {
        _state = 'new';
        throw e instanceof InitError ? e : new InitError(`init failed: ${e.message ?? e}`);
    }
}

/**
 * synthesize(ipa, options?) → Promise<{pcm: Int16Array, sampleRate: 22050, durationMs}>
 * Whole-utterance: resolves after the full PCM buffer is ready.
 * options: { rate?: 80–450 (default 175), pitch?: 0–99 (default 50) }
 */
export async function synthesize(ipa, options = {}) {
    if (_state !== 'ready') throw new DriverStateError('synthesize: call init() first');
    if (typeof ipa !== 'string') throw new TypeError('synthesize: ipa must be a string');
    const text = ipa.normalize('NFC');
    if ([...text].length > MAX_INPUT_CHARS) {
        throw new SynthesisError(`input exceeds ${MAX_INPUT_CHARS} characters`);
    }
    const mnemonics = `[[${mapToMnemonics(text)}]]`;
    // Contract semantics: rate/pitch fall back to defaults per call, so a
    // caller's previous custom values never leak into a later default call.
    _M.ccall('espeakng_set_rate', 'number', ['number'], [options.rate ?? DEFAULTS.rate]);
    _M.ccall('espeakng_set_pitch', 'number', ['number'], [options.pitch ?? DEFAULTS.pitch]);
    const n = _M.ccall('espeakng_synthesize', 'number', ['string'], [mnemonics]);
    if (n === -2) throw new SynthesisError(`engine rejected: ${mnemonics}`);
    if (n === -1) throw new SynthesisError('PCM buffer overflow (utterance too long)');
    if (n <= 0) throw new SynthesisError(`engine returned ${n} samples`);
    const ptr = _M.ccall('espeakng_pcm', 'number', [], []);
    const pcm = _M.HEAP16.slice(ptr >> 1, (ptr >> 1) + n);
    return { pcm, sampleRate: SAMPLE_RATE, durationMs: (n / SAMPLE_RATE) * 1000 };
}

/**
 * playIPA(ipa, options?) → Promise<void> — resolves when playback ends.
 * First call must be triggered from a user gesture (browser autoplay policy).
 */
export async function playIPA(ipa, options = {}) {
    const { pcm, sampleRate } = await synthesize(ipa, options);
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) throw new DriverStateError('playIPA: no AudioContext in this environment');
    _audioCtx ??= new Ctor();
    if (_audioCtx.state === 'suspended') await _audioCtx.resume();
    const buf = _audioCtx.createBuffer(1, pcm.length, sampleRate);
    const channel = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
    const src = _audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_audioCtx.destination);
    return new Promise((resolve) => {
        src.onended = () => resolve();
        src.start();
    });
}

/** terminate() — frees engine resources; the driver is re-initializable. */
export function terminate() {
    if (_state === 'ready') _M.ccall('espeakng_terminate', null, [], []);
    _M = null;
    _rules = null;
    _state = 'terminated';
}
