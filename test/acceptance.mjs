// acceptance.mjs — functional acceptance suite (BUILDING.md, acceptance
// criterion 2): ≥ 20 IPA strings synthesize without error, with PCM verified
// programmatically non-silent (RMS above threshold) and of plausible
// duration. Cases: the frozen Aeneid I.1–7 gold standard plus derived cases
// covering every la.json mapping rule (see test/acceptance-cases.json).
//
// The suite also asserts, as a coverage proxy, that every mapping rule key
// appears in at least one case string — a case file that silently stops
// exercising a rule fails the suite.
//
// Usage: node test/acceptance.mjs        (exit 0 = pass, 1 = fail)

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
function fail(name, detail = '') {
    failures.push(name);
    console.error(`  FAIL ${name} ${detail}`);
}

function rmsOf(pcm) {
    let s = 0;
    for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
    return Math.sqrt(s / pcm.length);
}

const { cases } = JSON.parse(readFileSync(join(root, 'test', 'acceptance-cases.json'), 'utf8'));
const mapping = JSON.parse(readFileSync(join(root, 'mapping', 'la.json'), 'utf8'));

if (cases.length < 20) fail('case count', `need >= 20 cases, have ${cases.length}`);

// Coverage proxy: every rule key must appear (NFC) in at least one case.
const hay = cases.map((c) => c.ipa.normalize('NFC')).join('\n');
const uncovered = mapping.rules.filter((r) => !hay.includes(r.ipa.normalize('NFC')));
if (uncovered.length) {
    fail('rule coverage', `no case exercises: ${uncovered.map((r) => r.ipa).join(', ')}`);
} else {
    console.log(`  ok   rule coverage (all ${mapping.rules.length} la.json rules exercised)`);
}

const { init, synthesize, terminate } =
    await import(pathToFileURL(join(root, 'espeak-wasm-driver.js')).href);
await init({
    wasmURL: join(root, 'dist', 'espeak-ng.wasm'),
    dataURL: join(root, 'dist', 'espeak-ng.data'),
    loaderURL: pathToFileURL(join(root, 'dist', 'espeak-ng.js')).href,
    mapping,
});

for (const c of cases) {
    let r;
    try {
        r = await synthesize(c.ipa);
    } catch (e) {
        fail(c.id, `threw ${e.name}: ${e.message}`);
        continue;
    }
    const rms = rmsOf(r.pcm);
    const ok = r.sampleRate === 22050
        && rms > 500
        && r.durationMs > 100
        && r.durationMs < 20000;
    if (!ok) {
        fail(c.id, `rate=${r.sampleRate} rms=${rms.toFixed(0)} dur=${r.durationMs.toFixed(0)}ms`);
    } else {
        console.log(`  ok   ${c.id.padEnd(28)} ${(r.durationMs / 1000).toFixed(2)}s rms=${rms.toFixed(0)}`);
    }
}
terminate();

if (failures.length) {
    console.error(`acceptance: FAIL (${failures.length}: ${failures.join(', ')})`);
    process.exit(1);
}
console.log(`acceptance: PASS (${cases.length} cases)`);
