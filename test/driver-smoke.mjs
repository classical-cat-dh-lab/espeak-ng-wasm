// driver-smoke.mjs — headless verification of espeak-wasm-driver.js.
//
// Covers: init (inline mapping + file URLs), IPA→mnemonic mapping with
// stress repositioning, non-silent PCM, plausible duration, rate parameter
// effect, UnmappableSymbolError hard-error semantics + codepoint position
// spans, kind validation, atomic init lifecycle (concurrent init, late-stage
// failure, terminate mid-init), the 500-character boundary at rate 80, and
// DriverStateError. playIPA is browser-only (AudioContext), not covered here.
//
// Usage: node test/driver-smoke.mjs        (exit 0 = pass, 1 = fail)

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
function check(name, cond, detail = '') {
    if (cond) console.log(`  ok   ${name}`);
    else { failures.push(name); console.error(`  FAIL ${name} ${detail}`); }
}
function rmsOf(pcm) {
    let s = 0;
    for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
    return Math.sqrt(s / pcm.length);
}

const {
    init, synthesize, terminate,
    InitError, UnmappableSymbolError, DriverStateError,
} = await import(pathToFileURL(join(root, 'espeak-wasm-driver.js')).href);

const laMapping = JSON.parse(readFileSync(join(root, 'mapping', 'la.json'), 'utf8'));

// Note: under node, wasmURL/dataURL/loaderURL must be plain filesystem
// paths — the Emscripten loader feeds them to readFileSync, which does not
// accept file:// URLs. Browsers take real URLs. (INTERFACE.md §7)
const goodInit = () => ({
    wasmURL: join(root, 'dist', 'espeak-ng.wasm'),
    dataURL: join(root, 'dist', 'espeak-ng.data'),
    loaderURL: pathToFileURL(join(root, 'dist', 'espeak-ng.js')).href,
    mapping: laMapping,
});

// DriverStateError before init
let stateErr = null;
try { await synthesize('a'); } catch (e) { stateErr = e; }
check('DriverStateError before init', stateErr instanceof DriverStateError);

// H-02: concurrent init calls share a single in-flight promise; both
// resolve, and the driver lands in ready state exactly once.
await Promise.all([init(goodInit()), init(goodInit())]);
check('concurrent init resolves (single flight)', true);

// Aeneid I.1, Classical notation: long vowels, ŋ before kʷ, syllable dots,
// primary stress before syllable onsets.
const aeneid = 'ˈar.ma wɪr.ˈʊŋ.kʷe ˈka.noː';
const r1 = await synthesize(aeneid);
check('sampleRate 22050', r1.sampleRate === 22050);
check('PCM non-silent', rmsOf(r1.pcm) > 500, `rms=${rmsOf(r1.pcm).toFixed(0)}`);
check('duration plausible', r1.durationMs > 500 && r1.durationMs < 5000,
      `${r1.durationMs.toFixed(0)}ms`);

// Stress repositioning: same string without stress marks must be SHORTER-or-
// different output — sanity that ˈ is actually consumed, not passed through.
// (Acoustic equality is not asserted; espeak stress affects pitch/timing.)
const r2 = await synthesize('ar.ma wɪr.ʊŋ.kʷe ka.noː');
check('stress marks alter output', r1.pcm.length !== r2.pcm.length,
      `stressed=${r1.pcm.length} unstressed=${r2.pcm.length}`);

// Rate parameter: slower rate → longer PCM.
const slow = await synthesize(aeneid, { rate: 80 });
const fast = await synthesize(aeneid, { rate: 450 });
check('rate affects duration',
      slow.pcm.length > r1.pcm.length && r1.pcm.length > fast.pcm.length,
      `slow=${slow.pcm.length} mid=${r1.pcm.length} fast=${fast.pcm.length}`);

// Hard-error semantics: θ has no Latin mapping.
let unmappable = null;
try { await synthesize('ˈθa.la.mɔː'); } catch (e) { unmappable = e; }
check('UnmappableSymbolError for θ', unmappable instanceof UnmappableSymbolError,
      unmappable && `${unmappable.symbol}@${unmappable.position}`);

// L-01: position counts codepoint spans of the NFC input, whitespace spans
// included. Layout: a(0) space(1) \n(2) \t(3) θ(4).
let posErr = null;
try { await synthesize('a \n\tθ'); } catch (e) { posErr = e; }
check('position spans whitespace', posErr instanceof UnmappableSymbolError && posErr.position === 4,
      posErr && `${posErr.symbol}@${posErr.position}`);

let leadErr = null;
try { await synthesize('  θ'); } catch (e) { leadErr = e; }
check('position with leading whitespace', leadErr instanceof UnmappableSymbolError && leadErr.position === 2,
      leadErr && `${leadErr.symbol}@${leadErr.position}`);

terminate();

// M-07: kind is required — a rule without it (or with an invalid value)
// fails init with InitError instead of silently dropping stress.
let kindErr = null;
const noKind = { rules: [{ ipa: 'a', mnemonic: 'a' }] };
try { await init({ ...goodInit(), mapping: noKind }); } catch (e) { kindErr = e; }
check('missing kind → InitError', kindErr instanceof InitError, kindErr && kindErr.message);

let badKindErr = null;
const badKind = { rules: [{ ipa: 'a', mnemonic: 'a', kind: 'vowl' }] };
try { await init({ ...goodInit(), mapping: badKind }); } catch (e) { badKindErr = e; }
check('invalid kind → InitError', badKindErr instanceof InitError, badKindErr && badKindErr.message);

// H-02: a failed init leaves the driver re-initializable. Re-init with the
// la mapping plus an astral-codepoint rule (astral chars count as ONE
// codepoint for position reporting — L-01). Layout: a(0) emoji(1) space(2)
// θ(3); UTF-16 indexing would wrongly report 4.
const astralMapping = {
    ...laMapping,
    rules: [...laMapping.rules, { ipa: '\u{1F600}', mnemonic: 'a', kind: 'vowel' }],
};
await init({ ...goodInit(), mapping: astralMapping });
check('re-init after failed init', true);
let astralErr = null;
try { await synthesize('a\u{1F600} θ'); } catch (e) { astralErr = e; }
check('astral codepoint counts as one position',
      astralErr instanceof UnmappableSymbolError && astralErr.position === 3,
      astralErr && `${astralErr.symbol}@${astralErr.position}`);
terminate();

// H-02: late-stage init failure (engine voice missing) → InitError, and the
// half-built module is torn down; the driver recovers on the next init.
let voiceErr = null;
try { await init({ ...goodInit(), voice: 'xx' }); } catch (e) { voiceErr = e; }
check('late-stage init failure → InitError', voiceErr instanceof InitError,
      voiceErr && voiceErr.message);
await init(goodInit());
check('re-init after late-stage failure', true);

// H-02: terminate() while init is in flight — the late init must not commit
// over the terminated lifecycle; it rejects, and a fresh init still works.
terminate();
const inflight = init(goodInit());
terminate();
let superseded = null;
try { await inflight; } catch (e) { superseded = e; }
check('init superseded by terminate rejects', superseded instanceof InitError,
      superseded && superseded.message);
await init(goodInit());
check('re-init after superseded init', true);

// M-01: 500 IPA characters at rate 80 — the worst case the contract allows.
// The native engine renders ~80 s for this input; the v0.1.0 fixed 60 s PCM
// ceiling rejected it. The dynamic buffer must now succeed.
const big = await synthesize('a'.repeat(500), { rate: 80 });
check('500-char @ rate 80 succeeds past the old 60 s cap',
      big.pcm.length > 22050 * 60 && big.durationMs < 150000,
      `${(big.durationMs / 1000).toFixed(1)}s, ${big.pcm.length} samples`);

// terminate + DriverStateError afterwards
terminate();
let afterTerm = null;
try { await synthesize(aeneid); } catch (e) { afterTerm = e; }
check('DriverStateError after terminate', afterTerm instanceof DriverStateError);

if (failures.length) {
    console.error(`driver-smoke: FAIL (${failures.length}: ${failures.join(', ')})`);
    process.exit(1);
}
console.log('driver-smoke: PASS');
