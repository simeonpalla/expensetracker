// ocr.js — on-device bill OCR (Tesseract.js, WASM). The image never leaves
// the phone. Runtime files are self-hosted under /ocr (see
// scripts/copy-ocr-assets.mjs) because the CSP forbids CDNs. The whole
// library is a dynamic import, so it costs nothing until the first scan.

const MAX_SIDE = 1600;

// Downscale + grayscale + contrast stretch: faster and more accurate on
// phone photos than feeding the raw 12 MP image.
async function preprocess(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    let lo = 255,
        hi = 0;
    for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        d[i] = d[i + 1] = d[i + 2] = g;
        if (g < lo) lo = g;
        if (g > hi) hi = g;
    }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
        const v = ((d[i] - lo) * 255) / range;
        d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export async function readBillText(file, onProgress) {
    const [{ createWorker }, image] = await Promise.all([import('tesseract.js'), preprocess(file)]);
    const base = import.meta.env.BASE_URL || '/';
    const worker = await createWorker('eng', 1, {
        workerPath: `${base}ocr/worker.min.js`,
        corePath: `${base}ocr`,
        langPath: `${base}ocr`,
        workerBlobURL: false,
        logger: m => {
            if (m.status === 'recognizing text') onProgress?.(m.progress);
        }
    });
    try {
        // Receipts are a single block of text lines.
        await worker.setParameters({ tessedit_pageseg_mode: '6' });
        const { data } = await worker.recognize(image);
        return data.text;
    } finally {
        await worker.terminate();
    }
}
