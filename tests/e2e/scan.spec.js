// Bill scanning: renders a fake printed receipt, uploads it, and checks the
// real on-device OCR (Tesseract WASM, under the production CSP) fills the
// Add Transaction form with the payable total — not an item or the tax.
const { test, expect } = require('@playwright/test');

const RECEIPT_HTML = `<body style="margin:0;background:#fff"><pre id="r" style="margin:0;padding:24px;width:520px;
font:600 26px/1.5 'Courier New',monospace;color:#000;background:#fff">
SUNRISE SUPERMARKET
Date: 21/09/2026
Milk 2 x 30.00        60.00
Bread                 45.00
Rice 5kg             410.00
Subtotal             515.00
CGST 2.5%             12.88
SGST 2.5%             12.88
Grand Total          540.76
Cash Tendered        600.00
Change                59.24
</pre></body>`;

test('scanning a printed bill fills the form with the grand total', async ({ page, browser }) => {
    test.setTimeout(120000);

    const shot = await browser.newPage();
    await shot.setContent(RECEIPT_HTML);
    const png = await shot.locator('#r').screenshot();
    await shot.close();

    await page.route('**/.netlify/functions/**', route => {
        const fn = new URL(route.request().url()).pathname.split('/').pop();
        const body =
            fn === 'me'
                ? { user: { id: 'u', email: 'e@x.co' } }
                : fn === 'categories'
                  ? [{ id: 2, name: 'Food', type: 'expense', icon: '🍕' }]
                  : [];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const csp = [];
    page.on('console', m => {
        if (/Content Security Policy/i.test(m.text())) csp.push(m.text());
    });

    await page.goto('/');
    await expect(page.locator('#status-text')).toHaveText('Connected');
    await page.setInputFiles('.scan-bill input[type="file"]', {
        name: 'bill.png',
        mimeType: 'image/png',
        buffer: png
    });

    await expect(page.locator('#amount')).toHaveValue('540.76', { timeout: 100000 });
    await expect(page.locator('.scan-result')).toContainText('Filled from your bill');
    await expect(page.locator('#date')).toHaveValue('2026-09-21');
    expect(csp).toEqual([]);
});
