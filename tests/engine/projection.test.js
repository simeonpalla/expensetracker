import { describe, it, expect } from 'vitest';
import projection from '../../src/engine/projection.js';

const salary = (date, amount = 30000) => ({
    type: 'income', category: 'Salary', transaction_date: date, amount
});
const expense = (date, amount, category = 'Food') => ({
    type: 'expense', category, transaction_date: date, amount
});

// A history with >=10 expenses spread over two past cycles, so pattern mode
// activates for the cycle starting 2026-07-01.
function patternHistory() {
    const txs = [salary('2026-05-01'), salary('2026-06-01'), salary('2026-07-01')];
    // Same shape in both past cycles: day 2 = 100, day 5 = 300, days 8-12 = 50
    for (const start of ['2026-05-', '2026-06-']) {
        txs.push(expense(`${start}02`, 100));
        txs.push(expense(`${start}05`, 300));
        for (let d = 8; d <= 12; d++) txs.push(expense(`${start}${String(d).padStart(2, '0')}`, 50));
    }
    return txs;
}

describe('projectCycle — mode selection', () => {
    it('empty data: recency mode, zero everything, no NaN', () => {
        const r = projection.projectCycle([], '2026-07-01', '2026-07-07');
        expect(r.mode).toBe('recency');
        expect(r.income).toBe(0);
        expect(r.expensesSoFar).toBe(0);
        expect(r.projectedFutureSpend).toBe(0);
        expect(r.projectedBalance).toBe(0);
        expect(Number.isFinite(r.dailyBurnRate)).toBe(true);
    });

    it('fewer than 10 historical expenses -> weighted-recency mode', () => {
        const txs = [salary('2026-06-01'), expense('2026-06-05', 100), salary('2026-07-01')];
        const r = projection.projectCycle(txs, '2026-07-01', '2026-07-07');
        expect(r.mode).toBe('recency');
    });

    it('10+ historical expenses -> pattern mode', () => {
        const r = projection.projectCycle(patternHistory(), '2026-07-01', '2026-07-07');
        expect(r.mode).toBe('pattern');
    });

    it('first cycle ever (no history at all) -> recency mode', () => {
        const txs = [salary('2026-07-01'), expense('2026-07-03', 200)];
        const r = projection.projectCycle(txs, '2026-07-01', '2026-07-07');
        expect(r.mode).toBe('recency');
        expect(r.income).toBe(30000);
        expect(r.expensesSoFar).toBe(200);
    });
});

describe('projectCycle — pattern mode', () => {
    it('projects each remaining day from its historical average', () => {
        // Today is day 7. Remaining pattern days: 8..12 avg 50 each = 250.
        // (Day 2 and 5 already passed and must NOT be projected again.)
        const r = projection.projectCycle(patternHistory(), '2026-07-01', '2026-07-07');
        expect(r.projectedFutureSpend).toBeCloseTo(250, 5);
        expect(r.daysPassed).toBe(7);
    });

    it('cycle length comes from salary history, not a hard-coded 30', () => {
        // Salary gaps of 31 days; an expense on day 31 of past cycles must be
        // included in the projection (the old code stopped at day 30).
        const txs = [salary('2026-04-30'), salary('2026-05-31'), salary('2026-07-01')];
        for (const [start, d31] of [['2026-04-30', '2026-05-30'], ['2026-05-31', '2026-06-30']]) {
            txs.push(expense(d31, 1000)); // day 31 of that cycle
            for (let i = 2; i <= 6; i++) {
                const day = new Date(Date.UTC(2026, Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)) + i - 1, 12));
                txs.push(expense(day.toISOString().slice(0, 10), 10));
            }
        }
        const r = projection.projectCycle(txs, '2026-07-01', '2026-07-07');
        expect(r.cycleLength).toBe(31);
        expect(r.mode).toBe('pattern');
        // day-31 average (1000) must be part of the future spend
        expect(r.projectedFutureSpend).toBeGreaterThanOrEqual(1000);
    });

    it('deep into an over-long cycle: no negative days remaining', () => {
        const r = projection.projectCycle(patternHistory(), '2026-07-01', '2026-08-15');
        expect(r.daysRemaining).toBe(0);
        expect(r.projectedFutureSpend).toBe(0); // nothing left to project
    });
});

describe('projectCycle — weighted-recency mode', () => {
    it('weights the last 7 days at 60% and earlier days at 40%', () => {
        // Cycle started 14 days ago. Earlier window (days 1-7): 700 total.
        // Recent window (last 7 days incl. today): 1400 total.
        const txs = [salary('2026-07-01', 30000)];
        txs.push(expense('2026-07-02', 700));   // earlier
        txs.push(expense('2026-07-10', 1400));  // recent (>= 2026-07-08)
        const r = projection.projectCycle(txs, '2026-07-01', '2026-07-14');

        expect(r.mode).toBe('recency');
        expect(r.daysPassed).toBe(14);
        const recentRate = 1400 / 7;   // 200/day
        const earlierRate = 700 / 7;   // 100/day
        const expectedRate = recentRate * 0.6 + earlierRate * 0.4; // 160/day
        expect(r.projectedFutureSpend).toBeCloseTo(expectedRate * r.daysRemaining, 5);
    });

    it('cycle younger than 8 days: earlier rate falls back to recent rate', () => {
        const txs = [salary('2026-07-01', 30000), expense('2026-07-02', 300)];
        const r = projection.projectCycle(txs, '2026-07-01', '2026-07-03');
        expect(r.daysPassed).toBe(3);
        const recentRate = 300 / 3;
        // earlierDays = 0 -> earlierRate falls back to recentRate -> flat rate
        expect(r.projectedFutureSpend).toBeCloseTo(recentRate * r.daysRemaining, 5);
    });

    it('quiet week is a real signal: zero recent spend lowers the projection', () => {
        // All spend was early in the cycle; the last 7 days are quiet.
        const txs = [salary('2026-07-01', 30000), expense('2026-07-02', 7000)];
        const r = projection.projectCycle(txs, '2026-07-01', '2026-07-14');
        const earlierRate = 7000 / 7; // 1000/day in the earlier window
        // recentRate = 0, so rate = 0*0.6 + 1000*0.4 = 400/day
        expect(r.projectedFutureSpend).toBeCloseTo(400 * r.daysRemaining, 5);
    });
});

describe('linearRegression', () => {
    it('flat data: zero slope', () => {
        const { slope, trend } = projection.linearRegression([100, 100, 100]);
        expect(slope).toBe(0);
        expect(trend).toEqual([100, 100, 100]);
    });

    it('perfect line: recovers slope and intercept', () => {
        const { slope, intercept } = projection.linearRegression([10, 20, 30, 40]);
        expect(slope).toBeCloseTo(10, 9);
        expect(intercept).toBeCloseTo(10, 9);
    });

    it('empty and single-point inputs are safe', () => {
        expect(projection.linearRegression([]).trend).toEqual([]);
        expect(projection.linearRegression([42]).trend).toEqual([42]);
    });
});

describe('computeAnomalies', () => {
    it('flags only >=10% AND >=500 variance, sorted by absolute diff', () => {
        const current = { Food: 5000, Rent: 10100, Coffee: 550, Travel: 2000 };
        const historical = { Food: 3000, Rent: 10000, Coffee: 100, Travel: 4000 };
        const anomalies = projection.computeAnomalies(current, historical, 1);
        // Food: +2000 (+67%) ok. Rent: +100 (<500) no. Coffee: +450 (<500) no.
        // Travel: under average, no.
        expect(anomalies.map(a => a.cat)).toEqual(['Food']);
        expect(anomalies[0].diff).toBe(2000);
    });

    it('no history -> no anomalies (histAvg 0 is never flagged)', () => {
        expect(projection.computeAnomalies({ Food: 9000 }, {}, 1)).toEqual([]);
    });
});

describe('weekendWeekdayStats', () => {
    it('averages per day with data, weekend vs weekday', () => {
        // 2026-07-04 = Saturday, 2026-07-06 = Monday
        const txs = [
            expense('2026-07-04', 500), expense('2026-07-04', 500), // one weekend day, 1000
            expense('2026-07-06', 300)                              // one weekday, 300
        ];
        const s = projection.weekendWeekdayStats(txs);
        expect(s.weekendAvg).toBe(1000);
        expect(s.weekdayAvg).toBe(300);
        expect(s.weekendDays).toBe(1);
        expect(s.weekdayDays).toBe(1);
    });

    it('empty input -> zeros, no division by zero', () => {
        const s = projection.weekendWeekdayStats([]);
        expect(s).toEqual({ weekendAvg: 0, weekdayAvg: 0, weekendDays: 0, weekdayDays: 0 });
    });
});

describe('cycleExpenseTotals', () => {
    it('one total per salary cycle, oldest first', () => {
        const txs = [
            salary('2026-05-01'), expense('2026-05-10', 100),
            salary('2026-06-01'), expense('2026-06-10', 200),
            salary('2026-07-01'), expense('2026-07-03', 50)
        ];
        const totals = projection.cycleExpenseTotals(txs, '2026-07-07');
        expect(totals.map(t => t.total)).toEqual([100, 200, 50]);
        expect(totals[0].start).toBe('2026-05-01');
        expect(totals[2].end).toBe('2026-07-07');
    });

    it('no salaries -> empty (no fake cycles for the trend chart)', () => {
        expect(projection.cycleExpenseTotals([expense('2026-07-03', 10)], '2026-07-07')).toEqual([]);
    });
});

describe('historicalMonths', () => {
    it('no history -> 1 (avoids divide-by-zero in anomaly baselines)', () => {
        expect(projection.historicalMonths([], '2026-07-01')).toBe(1);
    });

    it('about two months of history -> ~2', () => {
        const txs = [expense('2026-05-01', 10)];
        const m = projection.historicalMonths(txs, '2026-07-01');
        expect(m).toBeGreaterThan(1.9);
        expect(m).toBeLessThan(2.1);
    });
});
