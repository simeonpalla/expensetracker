// Copies the self-hosted OCR runtime (worker, wasm core, English model)
// into public/ocr so nothing loads from a CDN (the CSP forbids it).
// Output is gitignored; runs before dev/build.
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const out = 'public/ocr';
mkdirSync(out, { recursive: true });
const files = [
    ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
    ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
    ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
    [
        'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
        'tesseract-core-relaxedsimd-lstm.wasm.js'
    ],
    ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz']
];
for (const [src, dest] of files) {
    if (!existsSync(src)) throw new Error(`Missing OCR asset: ${src}`);
    cpSync(src, `${out}/${dest}`);
}
