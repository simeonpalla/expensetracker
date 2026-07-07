// engine/cycles.js — salary-cycle derivation and streaks. Pure logic.
//
// A cycle starts on the day a salary lands and ends the day before the next
// salary (the current cycle ends "today"). This is the load-bearing model the
// whole dashboard is built on — behavior matches the original script.js
// implementation except that all date math is timezone-safe.
//
import dates from './dates.js';

function isSalaryTx(t) {
    return t.type === 'income' && String(t.category || '').toLowerCase().includes('salary');
}

// Salary transactions sorted by date ascending.
function salaryTransactions(transactions) {
    return (transactions || [])
        .filter(isSalaryTx)
        .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
}

// Cycles, newest first: [{ start, end, isCurrent }].
// With no salary history, falls back to one calendar-month-to-date cycle.
function deriveCycles(transactions, today) {
    const salaries = salaryTransactions(transactions);

    if (salaries.length === 0) {
        return [{ start: `${today.slice(0, 8)}01`, end: today, isCurrent: true, fallback: true }];
    }

    const cycles = [];
    for (let i = salaries.length - 1; i >= 0; i--) {
        const start = salaries[i].transaction_date;
        if (i === salaries.length - 1) {
            cycles.push({ start, end: today, isCurrent: true });
        } else {
            cycles.push({ start, end: dates.addDays(salaries[i + 1].transaction_date, -1), isCurrent: false });
        }
    }
    return cycles;
}

// Expected length of the current cycle in days: the median gap between
// consecutive salaries. Falls back to 30 with fewer than 2 salaries and
// clamps to a sane payroll range. (Replaces the hard-coded 30 that made
// projections ignore days 31+ of long cycles and go negative on short ones.)
function expectedCycleLength(transactions) {
    const gaps = [];
    const salaries = salaryTransactions(transactions);
    for (let i = 1; i < salaries.length; i++) {
        const gap = dates.diffDays(salaries[i - 1].transaction_date, salaries[i].transaction_date);
        if (gap > 0) gaps.push(gap);
    }
    if (gaps.length === 0) return 30;
    gaps.sort((a, b) => a - b);
    const mid = Math.floor(gaps.length / 2);
    const median = gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
    return Math.min(45, Math.max(20, median));
}

// 1-based day number of `dateStr` within a cycle starting `cycleStart`.
function dayOfCycle(cycleStart, dateStr) {
    return dates.diffDays(cycleStart, dateStr) + 1;
}

function transactionsInCycle(transactions, start, end) {
    if (!start || !end) return [];
    return (transactions || []).filter(t =>
        t.transaction_date >= start && t.transaction_date <= end
    );
}

// Maps each historical expense to its day-of-cycle number across all past
// cycles: { dayNum: [amounts...] }. Expenses before the first salary have
// no cycle and are skipped (same as the original).
function historicalSpendByCycleDay(transactions, beforeDate) {
    const salaries = salaryTransactions(transactions);
    const out = {};
    (transactions || []).forEach(t => {
        if (t.type !== 'expense' || t.transaction_date >= beforeDate) return;
        let cycleStart = null;
        for (let i = salaries.length - 1; i >= 0; i--) {
            if (salaries[i].transaction_date <= t.transaction_date) {
                cycleStart = salaries[i].transaction_date;
                break;
            }
        }
        if (!cycleStart) return;
        const dayNum = dayOfCycle(cycleStart, t.transaction_date);
        (out[dayNum] = out[dayNum] || []).push(Number(t.amount));
    });
    return out;
}

// No-spend streak within a cycle. A day counts when it has no expense;
// today with no expense (yet) extends the current streak.
function noSpendStreak(cycleTxs, start, today) {
    if (!start || !today || dates.diffDays(start, today) < 0) {
        return { currentStreak: 0, bestStreak: 0 };
    }

    const spent = new Set();
    (cycleTxs || []).forEach(t => {
        if (t.type === 'expense') spent.add(t.transaction_date);
    });

    const days = dates.eachDay(start, today);

    let currentStreak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
        if (!spent.has(days[i])) currentStreak++;
        else break;
    }

    let bestStreak = 0, run = 0;
    days.forEach(d => {
        if (!spent.has(d)) { run++; bestStreak = Math.max(bestStreak, run); }
        else run = 0;
    });

    return { currentStreak, bestStreak };
}

export default {
isSalaryTx,
salaryTransactions,
deriveCycles,
expectedCycleLength,
dayOfCycle,
transactionsInCycle,
historicalSpendByCycleDay,
noSpendStreak
};
