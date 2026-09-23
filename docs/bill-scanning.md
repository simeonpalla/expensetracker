# Bill scanning

Scan a printed bill on **Add Transaction** (📷 Scan a bill). The photo is read
**on the device**; nothing is uploaded.

## Flow

1. The file input (`accept="image/*" capture="environment"`) opens the camera
   on phones.
2. `src/ocr.js` lazily imports Tesseract.js, downscales the image (max side
   1600 px), converts to grayscale and stretches contrast, then runs OCR in
   single-block mode (PSM 6).
3. `src/engine/receipt.js` parses the text into a total, date and merchant.
4. The form is prefilled (type = expense). Alternative amounts appear as
   tappable chips; the user always confirms before saving.

## How the total is chosen (item price vs total)

Every amount on the bill is scored from its line and position:

- **Strong** total lines (+10): grand total, net payable, amount payable,
  bill amount, balance due, to pay
- **Plain "total"** (+6)
- **Excluded** (−10): subtotal, tax/GST/CGST/SGST/IGST/VAT, service charge,
  discount, cash tendered, change, round-off, qty, MRP, rate, item counts
- Small bonuses for: a payment line repeating the amount, being the largest
  amount, having decimals, appearing near the bottom, and **subtotal + tax
  equalling the amount** (works even when labels are missing)

Confidence is *high* when the top score is clear of the runner-up.
Dates accept dd/mm/yy(yy), ISO and "5 Sep 2026"; future dates and dates more
than two years old are rejected. The merchant is the first plausible line.

## Self-hosted runtime (CSP)

The CSP forbids CDNs, so `scripts/copy-ocr-assets.mjs` copies the worker, the
WASM core (three CPU variants) and the English model from `node_modules` to
`public/ocr/` before `dev`/`build` (gitignored). The runtime is ~12 MB, fetched
on the **first scan only**, then cached by the service worker (`CacheFirst`,
cache `ocr-runtime`) so scanning works offline. It is excluded from precache.
`netlify.toml` allows `'wasm-unsafe-eval'` and `blob:` images for this.

## Limits

- Good on clean printed receipts; blur, glare and crumpled paper reduce
  accuracy. Handwriting is not supported.
- Tested end-to-end on a rendered receipt in desktop Chromium
  (`tests/e2e/scan.spec.js`), and the parser has unit tests. Try real bills on
  the target phone before promoting the feature.
- English only. More languages need more model files.
