// release-layout-smoke.mjs — verify the PACKAGED driver in dist/ against the
// flat GitHub Release layout (H-01).
//
// The Release ships a flat file set: espeak-wasm-driver.js and la.json side
// by side. This test imports the dist/ copy of the driver and calls init()
// with NO mappingURL and NO inline mapping, so the default resolution
// (./la.json alongside the driver) is exercised — in Node via the
// filesystem, matching INTERFACE.md §7. Run AFTER `bash build.sh` (dist/
// must be populated by the package stage).
//
// Usage: node test/release-layout-smoke.mjs    (exit 0 = pass, 1 = fail)

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

for (const f of ['espeak-wasm-driver.js', 'la.json', 'espeak-ng.js',
                 'espeak-ng.wasm', 'espeak-ng.data', 'LICENSE',
                 'manifest.json', 'sha256sums.txt']) {
    if (!existsSync(join(dist, f))) {
        console.error(`release-layout-smoke: FAIL: dist/${f} missing — run: bash build.sh`);
        process.exit(1);
    }
}

const { init, synthesize, terminate } =
    await import(pathToFileURL(join(dist, 'espeak-wasm-driver.js')).href);

// No mappingURL, no inline mapping: the driver must load ./la.json from
// alongside itself (Node fs path), and the loader defaults to ./espeak-ng.js.
await init({
    wasmURL: join(dist, 'espeak-ng.wasm'),
    dataURL: join(dist, 'espeak-ng.data'),
});

const r = await synthesize('ˈka.noː');
let sum = 0;
for (let i = 0; i < r.pcm.length; i++) sum += r.pcm[i] * r.pcm[i];
const rms = Math.sqrt(sum / r.pcm.length);
if (r.sampleRate !== 22050 || rms < 500) {
    console.error(`release-layout-smoke: FAIL: sampleRate=${r.sampleRate} rms=${rms.toFixed(0)}`);
    process.exit(1);
}
terminate();
console.log('release-layout-smoke: PASS');
