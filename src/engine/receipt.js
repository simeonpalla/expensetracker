// engine/receipt.js — turns raw OCR text from a printed bill into
// { total candidates, date, merchant }. Pure logic, no DOM, no OCR.
//
// The hard part is telling the payable total from item prices, subtotals,
// tax lines, cash tendered and change. Strategy: every amount on the bill
// is scored from its line's keywords and position, and the caller gets a
// ranked candidate list to confirm — never a silent guess.
import dates from './dates.js';

// Lines whose amount is the payable total (strongest first).
const STRONG_TOTAL =
    /(grand\s*total|net\s*(?:amount|payable|total)|amount\s*(?:payable|due)|total\s*(?:payable|due|amount)|bill\s*(?:amount|total)|balance\s*due|amt\s*payable|to\s*pay)/i;
const WEAK_TOTAL = /\btotal\b/i;
// Amounts on these lines are never the payable total.
const NOT_TOTAL =
    /(sub\s*-?\s*total|\btax\b|gst|cgst|sgst|igst|vat|cess|service\s*charge|discount|savings?|saved|cash|tendered|change|round\s*off|rounding|\bqty\b|quantity|items?\b|\bmrp\b|\brate\b|\bprice\b|points?|loyalty|balance\s*(?:brought|b\/f))/i;
// Payment lines usually repeat the total; treat as weak supporting evidence.
const PAID_LINE = /(\bpaid\b|card|upi|visa|master|debit|credit|net\s*banking|payment)/i;
const SUBTOTAL = /sub\s*-?\s*total/i;
const TAX_LINE = /(\btax\b|gst|cgst|sgst|igst|vat|cess|service\s*charge)/i;

// Matches 1,234.50 / 1234.5 / 1234 — with an optional currency marker.
const AMOUNT_RE = /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;

function amountsInLine(line) {
    const out = [];
    let m;
    AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(line)) !== null) {
        const raw = m[1];
        const value = Number(raw.replace(/,/g, ''));
        if (!Number.isFinite(value) || value <= 0) continue;
        const hasDecimals = /\.\d{1,2}$/.test(raw);
        // Bare integers are usually qty, phone numbers, invoice numbers, PIN
        // codes or dates. Keep them only when small-ish; they rank low.
        if (!hasDecimals && (value > 99999 || raw.length > 6)) continue;
        out.push({ value, hasDecimals });
    }
    return out;
}

function parseDate(text, today) {
    const months = {
        jan: 1,
        feb: 2,
        mar: 3,
        apr: 4,
        may: 5,
        jun: 6,
        jul: 7,
        aug: 8,
        sep: 9,
        oct: 10,
        nov: 11,
        dec: 12
    };
    const candidates = [];
    const push = (y, mo, d) => {
        if (y < 100) y += 2000;
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
        const s = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (!dates.isDateStr(s)) return;
        if (s > today) return;
        if (dates.diffDays(s, today) > 366 * 2) return;
        candidates.push(s);
    };
    let m;
    const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
    while ((m = iso.exec(text))) push(Number(m[1]), Number(m[2]), Number(m[3]));
    const dmy = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g;
    while ((m = dmy.exec(text))) push(Number(m[3]), Number(m[2]), Number(m[1]));
    const named =
        /\b(\d{1,2})[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.-]+(\d{2}|\d{4})\b/gi;
    while ((m = named.exec(text))) push(Number(m[3]), months[m[2].toLowerCase().slice(0, 3)], Number(m[1]));
    return candidates[0] || '';
}

function parseMerchant(lines) {
    const skip =
        /(invoice|receipt|bill\b|tax|gst|tel|phone|ph\b|mob|www\.|http|date|time|cashier|table|order|welcome|thank)/i;
    for (const line of lines.slice(0, 6)) {
        const letters = (line.match(/[A-Za-z]/g) || []).length;
        if (letters >= 3 && letters >= line.length * 0.5 && !skip.test(line)) {
            return line
                .replace(/[^A-Za-z0-9&'.\- ]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
    }
    return '';
}

// text: raw OCR output. today: 'YYYY-MM-DD' (injectable for tests).
function parseReceipt(text, today = dates.todayStr()) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);

    const found = []; // { value, line, index, score, ... }
    let subtotal = null;
    let taxSum = 0;

    lines.forEach((line, index) => {
        const amts = amountsInLine(line);
        if (!amts.length) return;
        const strong = STRONG_TOTAL.test(line);
        const weak = !strong && WEAK_TOTAL.test(line);
        const excluded = NOT_TOTAL.test(line) && !strong;
        const paid = PAID_LINE.test(line);

        if (SUBTOTAL.test(line)) subtotal = amts[amts.length - 1].value;
        else if (TAX_LINE.test(line) && !strong) taxSum += amts[amts.length - 1].value;

        // On "label ... amount" lines the amount is the last number.
        const a = amts[amts.length - 1];
        let score = 0;
        if (strong) score += 10;
        else if (weak && !excluded) score += 6;
        if (excluded) score -= 10;
        if (paid && !excluded) score += 1;
        if (a.hasDecimals) score += 1;
        else score -= 2;
        score += (index / Math.max(1, lines.length - 1)) * 2; // bills end with the total
        found.push({ value: a.value, line, index, score });
    });

    // Cross-checks: an amount repeated on a payment line, the largest
    // amount, and subtotal + tax arithmetic all raise confidence.
    const maxValue = found.reduce((m, f) => Math.max(m, f.value), 0);
    found.forEach(f => {
        if (f.value === maxValue && f.score > -5) f.score += 2;
        if (found.filter(o => o.value === f.value).length > 1 && f.score > -5) f.score += 2;
        if (subtotal && taxSum && Math.abs(subtotal + taxSum - f.value) <= 1.01) f.score += 4;
    });

    // One entry per distinct value, best score wins.
    const byValue = new Map();
    found.forEach(f => {
        const cur = byValue.get(f.value);
        if (!cur || f.score > cur.score) byValue.set(f.value, f);
    });
    const ranked = [...byValue.values()].sort((a, b) => b.score - a.score || b.value - a.value);

    const top = ranked[0];
    const second = ranked[1];
    let confidence = 'low';
    if (top && top.score >= 10) confidence = second && top.score - second.score < 2 ? 'medium' : 'high';
    else if (top && top.score >= 5) confidence = 'medium';

    return {
        total: top ? top.value : null,
        confidence,
        candidates: ranked.slice(0, 4).map(f => ({ value: f.value, label: f.line })),
        date: parseDate(text || '', today),
        merchant: parseMerchant(lines)
    };
}

export default { parseReceipt, amountsInLine, parseDate, parseMerchant };
