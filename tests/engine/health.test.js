import { describe, it, expect } from 'vitest';
import health from '../../src/engine/health.js';

const TODAY = '2026-09-16';
let id = 0;
const tx = (type, amount, date, extra = {}) => ({
    id: ++id,
    type,
    amount,
    transaction_date: date,
    category: type === 'income' ? 'Salary' : 'Food',
    payment_source: 'upi',
    ...extra
});

// Four finished cycles (Jun–Sep salaries on the 1st) + the current one
// (Sep 1 – Sep 16). Past cycles: income 50,000, spending 30,000.
function history(extra = []) {
    const out = [];
    ['2026-06-01', '2026-07-01', '2026-08-01'].forEach(start => {
        const month = start.slice(0, 7);
        out.push(tx('income', 50000, start));
        for (let d = 2; d <= 28; d += 3) {
            out.push(tx('expense', 3000, `${month}-${String(d).padStart(2, '0')}`, { category: 'Food' }));
        }
    });
    out.push(tx('income', 50000, '2026-09-01'));
    return [...out, ...extra];
}

describe('analyze', () => {
    it('reports a strong savings rate and category rows against the usual pace', () => {
        const txs = history([tx('expense', 4000, '2026-09-05', { category: 'Food' })]);
        const r = health.analyze({ transactions: txs, today: TODAY });
        expect(r.status).toBe('ok');
        expect(r.cycle.isCurrent).toBe(true);
        expect(r.priorCount).toBe(3);
        expect(r.totals.income).toBe(50000);
        expect(r.health.components.find(c => c.key === 'savings').score).toBeGreaterThan(80);
        const food = r.rows.find(x => x.cat === 'Food');
        expect(food.amount).toBe(4000);
        // Usual: 3,000 on days 2,5,8,11,14 -> by day 16 that is 15,000 per cycle.
        expect(food.usual).toBeGreaterThan(10000);
        expect(food.delta).toBeLessThan(0);
    });

    it('flags a projected deficit as the top, quantified action', () => {
        const txs = history([
            tx('expense', 45000, '2026-09-03', { category: 'Rent' }),
            tx('expense', 9000, '2026-09-10', { category: 'Shopping' })
        ]);
        const r = health.analyze({ transactions: txs, today: TODAY });
        expect(r.actions[0].id).toBe('deficit');
        expect(r.actions[0].severity).toBe('high');
        expect(r.actions[0].impact).toBeGreaterThan(0);
        expect(r.health.value).toBeLessThan(65);
    });

    it('calls out a category running well above its usual pace', () => {
        const txs = history([tx('expense', 20000, '2026-09-04', { category: 'Dining' })]);
        const r = health.analyze({ transactions: txs, today: TODAY });
        const rec = r.actions.find(a => a.id === 'cat-Dining');
        expect(rec).toBeTruthy();
        expect(rec.impact).toBeGreaterThan(15000);
    });

    it('surfaces credit-card spend as money already spent', () => {
        const txs = history([
            tx('expense', 12000, '2026-09-06', { category: 'Shopping', payment_source: 'credit-card' })
        ]);
        const r = health.analyze({ transactions: txs, today: TODAY });
        expect(r.cards.spent).toBe(12000);
        expect(r.actions.some(a => a.id === 'cards')).toBe(true);
    });

    it('builds a pace series comparing this cycle to the usual path', () => {
        const txs = history([tx('expense', 1000, '2026-09-02')]);
        const r = health.analyze({ transactions: txs, today: TODAY });
        expect(r.pace.dayN).toBe(16);
        expect(r.pace.actualToDate).toBe(1000);
        expect(r.pace.typicalToDate).toBeGreaterThan(10000);
        expect(r.pace.aheadBy).toBeGreaterThan(9000);
        expect(r.actions.some(a => a.id === 'ahead')).toBe(true);
    });

    it('leaves out components it lacks data for instead of inventing them', () => {
        const txs = [tx('income', 50000, '2026-09-01'), tx('expense', 5000, '2026-09-05')];
        const r = health.analyze({ transactions: txs, today: TODAY });
        const keys = r.health.components.map(c => c.key);
        expect(keys).toEqual(['savings']);
        expect(r.health.confidence).toBe('low');
        expect(r.pace).toBeNull();
    });

    it('scores budget adherence only when limits exist', () => {
        const txs = history([tx('expense', 9000, '2026-09-05', { category: 'Food' })]);
        const none = health.analyze({ transactions: txs, today: TODAY });
        expect(none.health.components.some(c => c.key === 'budgets')).toBe(false);
        const some = health.analyze({ transactions: txs, today: TODAY, budgetLimits: { Food: 5000 } });
        const b = some.health.components.find(c => c.key === 'budgets');
        expect(b.score).toBe(0);
    });

    it('reviewing a finished cycle uses its actuals and gives no live actions', () => {
        const txs = history();
        const r = health.analyze({ transactions: txs, today: TODAY, cycleIndex: 1 });
        expect(r.cycle.isCurrent).toBe(false);
        expect(r.actions).toEqual([]);
        expect(r.pace).toBeNull();
        expect(r.totals.expenses).toBe(27000);
    });

    it('handles an empty history', () => {
        const r = health.analyze({ transactions: [], today: TODAY });
        expect(r.status).toBe('ok');
        expect(r.health).toBeNull();
        expect(r.actions).toEqual([]);
    });
});
