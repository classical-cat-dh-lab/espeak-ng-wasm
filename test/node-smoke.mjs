// node-smoke.mjs — headless smoke test for the wasm build (local + CI).
//
// Instantiates dist/espeak-ng.js, initializes the engine with the preloaded
// trimmed data pack, selects the Latin voice, synthesizes a [[...]]
// phoneme-mnemonic string, then verifies programmatically:
//   - engine-reported sample rate is 22050 (INTERFACE.md §3)
//   - synthesis returned a plausible sample count
//   - PCM is non-silent (RMS above threshold)
//   - duration is plausible for the input
// Writes build/smoke/wasm-phon.wav for human review.
//
// Usage: node test/node-smoke.mjs        (exit 0 = pass, 1 = fail)

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
    console.error(`node-smoke: FAIL: ${msg}`);
    process.exit(1);
}

function encodeWav(pcm, sampleRate) {
    const dataLen = pcm.length * 2;
    const buf = Buffer.alloc(44 + dataLen);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);              // PCM
    buf.writeUInt16LE(1, 22);              // mono
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buf.writeUInt16LE(2, 32);              // block align
    buf.writeUInt16LE(16, 34);             // bits per sample
    buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
    for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
    return buf;
}

const { default: createModule } = await import(pathToFileURL(join(root, 'dist', 'espeak-ng.js')).href);
// locateFile: the loader resolves espeak-ng.wasm/.data relative to the
// process CWD otherwise; the browser driver will map wasmURL/dataURL the
// same way (INTERFACE.md §3).
const M = await createModule({
    locateFile: (file) => join(root, 'dist', file),
});

const sampleRate = M.ccall('espeakng_init', 'number', ['string'], ['/']);
if (sampleRate <= 0) fail(`espeakng_init returned ${sampleRate}`);
if (sampleRate !== 22050) fail(`expected sample rate 22050, got ${sampleRate}`);

if (M.ccall('espeakng_set_voice', 'number', ['string'], ['la']) !== 0)
    fail('espeakng_set_voice("la") failed');
if (M.ccall('espeakng_set_rate', 'number', ['number'], [175]) !== 0)
    fail('espeakng_set_rate failed');
if (M.ccall('espeakng_set_pitch', 'number', ['number'], [50]) !== 0)
    fail('espeakng_set_pitch failed');

// Same phoneme-mode input as the native smoke test (BUILDING.md step 4).
const input = '[[arma]]';
const n = M.ccall('espeakng_synthesize', 'number', ['string'], [input]);
if (n <= 0) fail(`espeakng_synthesize(${input}) returned ${n}`);

const ptr = M.ccall('espeakng_pcm', 'number', [], []);
const pcm = M.HEAP16.slice(ptr >> 1, (ptr >> 1) + n);

let sum = 0;
for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
const rms = Math.sqrt(sum / pcm.length);
const durationMs = (n / sampleRate) * 1000;

if (rms < 500) fail(`PCM looks silent (RMS=${rms.toFixed(0)})`);
if (durationMs < 100 || durationMs > 5000)
    fail(`implausible duration ${durationMs.toFixed(0)} ms for ${input}`);

mkdirSync(join(root, 'build', 'smoke'), { recursive: true });
writeFileSync(join(root, 'build', 'smoke', 'wasm-phon.wav'), encodeWav(pcm, sampleRate));

M.ccall('espeakng_terminate', null, [], []);

console.log(JSON.stringify({
    input, sampleRate, samples: n,
    durationMs: Math.round(durationMs), rms: Math.round(rms),
    wav: 'build/smoke/wasm-phon.wav',
}));
console.log('node-smoke: PASS');
