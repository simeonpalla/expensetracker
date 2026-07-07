// engine/projection.js — run-rate projection and insight computations.
// Pure logic, no DOM. This is the single implementation of the projection
// model that used to be copy-pasted three times in script.js.
//
// Model (unchanged from the original, documented in the README):
// - With >=10 historical expenses (before the current cycle): pattern-aware
//   mode. Each past expense maps to its day-of-cycle number; each remaining
//   day of the current cycle gets that day's historical average.
// - Otherwise: weighted-recency mode. Burn rate = last-7-days rate x 0.6 +
//   earlier-in-cycle rate x 0.4, times the remaining days.
//
// Two audited bugs are fixed here (with tests):
// - the cycle length is no longer hard-coded to 30 days; it comes from the
//   caller (median salary gap via PFCycles.expectedCycleLength)
// - in weighted-recency mode the day-window sizes are derived from days
//   passed, not from whether transactions happened to exist in the window.
//
// Browser: window.PFProjection (needs dates.js + cycles.js). Node: require().

(function (global) {
    'use strict';

    const isNode = typeof module === 'object' && module.exports;
    const dates = isNode ? require('./dates') : global.PFDates;
    const cycles = isNode ? require('./cycles') : global.PFCycles;

    const HISTORY_THRESHOLD = 10; // expenses needed for pattern mode

    // ---- projection ----

    // Historical-average spend for each remaining cycle day.
    // spendByDay: { dayNum: [amounts] } from PFCycles.historicalSpendByCycleDay.
    function patternFutureSpend(spendByDay, daysPassed, cycleLength) {
        let future = 0;
        for (let d = daysPassed + 1; d <= cycleLength; d++) {
            const amounts = spendByDay[d];
            if (amounts && amounts.length > 0) {
                future += amounts.reduce((s, v) => s + v, 0) / amounts.length;
            }
        }
        return future;
    }

    // Recency-weighted burn rate x remaining days.
    function weightedRecencyFutureSpend(cycleTxs, today, daysPassed, daysRemaining) {
        const recentWindowStart = dates.addDays(today, -6); // last 7 days incl. today
        let recentSpend = 0, earlierSpend = 0;

        (cycleTxs || []).forEach(t => {
            if (t.type !== 'expense') return;
            const amt = Number(t.amount);
            if (t.transaction_date >= recentWindowStart) recentSpend += amt;
            else earlierSpend += amt;
        });

        const recentDays = Math.min(7, daysPassed);
        const earlierDays = Math.max(0, daysPassed - 7);

        const recentRate = recentDays > 0 ? recentSpend / recentDays : 0;
        const earlierRate = earlierDays > 0 ? earlierSpend / earlierDays : recentRate;

        return ((recentRate * 0.6) + (earlierRate * 0.4)) * daysRemaining;
    }

    // The single entry point used by the dashboard card and the insights page.
    // transactions: all of the user's transactions. cycleStart/today: date strings.
    function projectCycle(transactions, cycleStart, today) {
        const cycleTxs = cycles.transactionsInCycle(transactions, cycleStart, today);

        let income = 0, expensesSoFar = 0;
        cycleTxs.forEach(t => {
            const amt = Number(t.amount);
            if (t.type === 'income') income += amt;
            else if (t.type === 'expense') expensesSoFar += amt;
        });

        const daysPassed = Math.max(1, cycles.dayOfCycle(cycleStart, today));
        const cycleLength = cycles.expectedCycleLength(transactions);
        const daysRemaining = Math.max(0, cycleLength - daysPassed);

        const historicalExpenses = (transactions || []).filter(t =>
            t.type === 'expense' && t.transaction_date < cycleStart
        );

        let mode, projectedFutureSpend;
        if (historicalExpenses.length >= HISTORY_THRESHOLD) {
            mode = 'pattern';
            const spendByDay = cycles.historicalSpendByCycleDay(transactions, cycleStart);
            projectedFutureSpend = patternFutureSpend(spendByDay, daysPassed, cycleLength);
        } else {
            mode = 'recency';
            projectedFutureSpend = weightedRecencyFutureSpend(cycleTxs, today, daysPassed, daysRemaining);
        }

        return {
            mode,
            income,
            expensesSoFar,
            projectedFutureSpend,
            projectedBalance: income - (expensesSoFar + projectedFutureSpend),
            dailyBurnRate: expensesSoFar / daysPassed,
            daysPassed,
            daysRemaining,
            cycleLength
        };
    }

    // ---- regression (chart trend line) ----

    // Least-squares line over evenly spaced values. Returns per-point trend
    // values rounded to 2 decimals (matching the chart's original output).
    function linearRegression(values) {
        const n = values.length;
        if (n === 0) return { slope: 0, intercept: 0, trend: [] };
        const xMean = (n - 1) / 2;
        const yMean = values.reduce((a, b) => a + b, 0) / n;
        let num = 0, den = 0;
        values.forEach((y, x) => {
            num += (x - xMean) * (y - yMean);
            den += (x - xMean) ** 2;
        });
        const slope = den !== 0 ? num / den : 0;
        const intercept = yMean - slope * xMean;
        return {
            slope,
            intercept,
            trend: values.map((_, x) => parseFloat((slope * x + intercept).toFixed(2)))
        };
    }

    // ---- insight computations ----

    // Per-category spend map for a list of transactions.
    function spendByCategory(txs) {
        const out = {};
        (txs || []).forEach(t => {
            if (t.type === 'expense') {
                out[t.category] = (out[t.category] || 0) + Number(t.amount);
            }
        });
        return out;
    }

    // How many months of history exist before cycleStart (>= 1).
    function historicalMonths(transactions, cycleStart) {
        const historical = (transactions || []).filter(t => t.transaction_date < cycleStart);
        if (historical.length === 0) return 1;
        let earliest = historical[0].transaction_date;
        historical.forEach(t => { if (t.transaction_date < earliest) earliest = t.transaction_date; });
        const msPerMonth = 86400000 * 30.44;
        const span = dates.diffDays(earliest, cycleStart) * 86400000;
        return Math.max(1, span / msPerMonth);
    }

    // Categories over historical average by >=10% and >=minDiff rupees.
    function computeAnomalies(currentSpend, historicalSpend, months, minDiff = 500) {
        const anomalies = [];
        Object.keys(currentSpend).forEach(cat => {
            const currentAmt = currentSpend[cat];
            const histAvg = (historicalSpend[cat] || 0) / months;
            if (currentAmt > histAvg && histAvg > 0) {
                const diff = currentAmt - histAvg;
                const pct = (diff / histAvg) * 100;
                if (pct >= 10 && diff >= minDiff) {
                    anomalies.push({ cat, currentAmt, histAvg, diff, pct });
                }
            }
        });
        return anomalies.sort((a, b) => b.diff - a.diff);
    }

    // Average spend per weekend day vs per weekday, over days that had expenses.
    function weekendWeekdayStats(expenseTxs) {
        let weekendSpend = 0, weekdaySpend = 0, weekendDays = 0, weekdayDays = 0;

        const isWeekend = dateStr => {
            const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
            return dow === 0 || dow === 6;
        };

        (expenseTxs || []).forEach(t => {
            const amt = Number(t.amount);
            if (isWeekend(t.transaction_date)) weekendSpend += amt;
            else weekdaySpend += amt;
        });

        new Set((expenseTxs || []).map(t => t.transaction_date)).forEach(d => {
            if (isWeekend(d)) weekendDays++;
            else weekdayDays++;
        });

        return {
            weekendAvg: weekendDays > 0 ? weekendSpend / weekendDays : 0,
            weekdayAvg: weekdayDays > 0 ? weekdaySpend / weekdayDays : 0,
            weekendDays,
            weekdayDays
        };
    }

    // Total expenses per salary cycle, oldest first: [{ start, end, total }].
    function cycleExpenseTotals(transactions, today) {
        const list = cycles.deriveCycles(transactions, today);
        if (list.length && list[0].fallback) return [];
        return list
            .slice()
            .reverse()
            .map(c => ({
                start: c.start,
                end: c.end,
                total: cycles.transactionsInCycle(transactions, c.start, c.end)
                    .filter(t => t.type === 'expense')
                    .reduce((s, t) => s + Number(t.amount), 0)
            }));
    }

    const api = {
        HISTORY_THRESHOLD,
        projectCycle,
        patternFutureSpend,
        weightedRecencyFutureSpend,
        linearRegression,
        spendByCategory,
        historicalMonths,
        computeAnomalies,
        weekendWeekdayStats,
        cycleExpenseTotals
    };

    if (isNode) module.exports = api;
    else global.PFProjection = api;
})(typeof window !== 'undefined' ? window : globalThis);
