// engine/dates.js — timezone-safe date-string helpers.
//
// Every date in the app is a plain local-calendar day ("YYYY-MM-DD").
// The old code mixed `new Date().toISOString()` (UTC) with local rendering,
// which shifted "today" to yesterday between 00:00 and 05:30 IST. These
// helpers only ever use local time, and day arithmetic is done on UTC
// noon-anchored timestamps so DST/offset changes can't skew the math.
//
// Pure ES module: no DOM, no globals.

// Local-calendar date string for a Date instance.
function toDateStr(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Today in the user's local timezone. `now` is injectable for tests.
function todayStr(now) {
    return toDateStr(now instanceof Date ? now : new Date());
}

function isDateStr(v) {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// Anchor at UTC noon: immune to DST transitions and host timezone.
function anchor(dateStr) {
    return Date.UTC(
        Number(dateStr.slice(0, 4)),
        Number(dateStr.slice(5, 7)) - 1,
        Number(dateStr.slice(8, 10)),
        12
    );
}

// Whole calendar days from a to b (positive when b is later).
function diffDays(aStr, bStr) {
    return Math.round((anchor(bStr) - anchor(aStr)) / 86400000);
}

function addDays(dateStr, n) {
    const d = new Date(anchor(dateStr) + n * 86400000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Inclusive range of date strings.
function eachDay(startStr, endStr) {
    const out = [];
    const n = diffDays(startStr, endStr);
    for (let i = 0; i <= n; i++) out.push(addDays(startStr, i));
    return out;
}

// Local-midnight Date for a date string (for rendering via toLocaleDateString).
function parseLocal(dateStr) {
    return new Date(
        Number(dateStr.slice(0, 4)),
        Number(dateStr.slice(5, 7)) - 1,
        Number(dateStr.slice(8, 10))
    );
}

export default { toDateStr, todayStr, isDateStr, diffDays, addDays, eachDay, parseLocal };
