import { describe, it, expect } from 'vitest';
import receipt from '../../src/engine/receipt.js';

const TODAY = '2026-09-23';

describe('parseReceipt', () => {
    it('picks the grand total over item prices, subtotal, tax and cash/change', () => {
        const text = `SUNRISE SUPERMARKET
GSTIN 29ABCDE1234F1Z5
Date: 21/09/2026
Milk 2 x 30.00        60.00
Bread                 45.00
Rice 5kg             410.00
Subtotal             515.00
CGST 2.5%             12.88
SGST 2.5%             12.88
Grand Total          540.76
Cash Tendered        600.00
Change                59.24`;
        const r = receipt.parseReceipt(text, TODAY);
        expect(r.total).toBe(540.76);
        expect(r.confidence).toBe('high');
        expect(r.date).toBe('2026-09-21');
        expect(r.merchant).toBe('SUNRISE SUPERMARKET');
    });

    it('does not mistake the largest item for the total when a TOTAL line exists', () => {
        const text = `CAFE ROOT
Biryani 320.00
Lassi 90.00
Total 410.00`;
        expect(receipt.parseReceipt(text, TODAY).total).toBe(410);
    });

    it('ignores a subtotal line larger than nothing else and prefers the amount payable', () => {
        const text = `Store
Sub Total 1,000.00
Discount 100.00
Amount Payable 900.00`;
        expect(receipt.parseReceipt(text, TODAY).total).toBe(900);
    });

    it('handles Indian comma grouping and rupee markers', () => {
        const text = `Shop
Net Payable Rs. 12,450.00`;
        expect(receipt.parseReceipt(text, TODAY).total).toBe(12450);
    });

    it('uses subtotal + tax arithmetic when labels are weak', () => {
        const text = `Shop
Subtotal 100.00
GST 18.00
118.00
Thank you`;
        expect(receipt.parseReceipt(text, TODAY).total).toBe(118);
    });

    it('offers ranked candidates so the UI can let the user correct it', () => {
        const r = receipt.parseReceipt('A\nTea 20.00\nSnack 40.00\nTotal 60.00', TODAY);
        expect(r.candidates[0].value).toBe(60);
        expect(r.candidates.length).toBeGreaterThan(1);
    });

    it('returns nulls for text with no amounts', () => {
        const r = receipt.parseReceipt('nothing here', TODAY);
        expect(r.total).toBeNull();
        expect(r.candidates).toEqual([]);
    });
});

describe('parseDate', () => {
    it('parses dd-mm-yy, ISO and named months; rejects future dates', () => {
        expect(receipt.parseDate('12-03-26', TODAY)).toBe('2026-03-12');
        expect(receipt.parseDate('2026-09-01', TODAY)).toBe('2026-09-01');
        expect(receipt.parseDate('5 Sep 2026', TODAY)).toBe('2026-09-05');
        expect(receipt.parseDate('01/01/2030', TODAY)).toBe('');
    });
});
