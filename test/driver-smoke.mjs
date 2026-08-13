// driver-smoke.mjs — headless verification of espeak-wasm-driver.js.
//
// Covers: init (inline mapping + file URLs), IPA→mnemonic mapping with
// stress repositioning, non-silent PCM, plausible duration, rate parameter
// effect, UnmappableSymbolError hard-error semantics, DriverStateError.
// playIPA is browser-only (AudioContext) and not covered here.
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
    UnmappableSymbolError, DriverStateError,
} = await import(pathToFileURL(join(root, 'espeak-wasm-driver.js')).href);

// DriverStateError before init
let stateErr = null;
try { await synthesize('a'); } catch (e) { stateErr = e; }
check('DriverStateError before init', stateErr instanceof DriverStateError);

const mapping = JSON.parse(readFileSync(join(root, 'mapping', 'la.json'), 'utf8'));
// Note: under node, wasmURL/dataURL/loaderURL must be plain filesystem
// paths — the Emscripten loader feeds them to readFileSync, which does not
// accept file:// URLs. Browsers take real URLs. (INTERFACE.md §7)
await init({
    wasmURL: join(root, 'dist', 'espeak-ng.wasm'),
    dataURL: join(root, 'dist', 'espeak-ng.data'),
    loaderURL: pathToFileURL(join(root, 'dist', 'espeak-ng.js')).href,
    mapping,
});
check('init resolves', true);

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
