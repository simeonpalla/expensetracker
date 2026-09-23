// engine/health.js — turns a user's transaction history into a financial
// health picture: a transparent score, category-vs-usual variances, a
// pace-vs-usual series, credit-card dues and ranked, quantified actions.
// Pure logic, no DOM.
//
// Principles (so the numbers can be trusted):
// - Everything is derived from the user's own tracked entries and is said
//   to be an estimate. Components with too little data are left OUT and
//   the score re-weights over what remains — never filled with defaults.
// - "Usual" means the average of the user's own previous completed salary
//   cycles, compared over the same number of days into the cycle, so a
//   half-finished cycle is never judged against a finished one.
// - Every recommendation carries the evidence and a rupee impact.
import dates from './dates.js';
import cycles from './cycles.js';
import projection from './projection.js';

const HISTORY_CYCLES = 6;
const SAVINGS_TARGET = 0.2;
const SMALL_SPEND = 200;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const sum = arr => arr.reduce((s, v) => s + v, 0);
const amt = t => Number(t.amount) || 0;
const inr = n => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;

function summarize(transactions, c) {
    const txs = cycles.transactionsInCycle(transactions, c.start, c.end);
    let income = 0,
        expenses = 0,
        recurring = 0;
    const byCategory = {};
    const bySource = {};
    txs.forEach(t => {
        const a = amt(t);
        if (t.type === 'income') income += a;
        else if (t.type === 'expense') {
            expenses += a;
            byCategory[t.category] = (byCategory[t.category] || 0) + a;
            const src = t.payment_source || 'unknown';
            bySource[src] = (bySource[src] || 0) + a;
            if (t.is_recurring) recurring += a;
        }
    });
    return {
        start: c.start,
        end: c.end,
        isCurrent: Boolean(c.isCurrent),
        fallback: Boolean(c.fallback),
        txs,
        income,
        expenses,
        net: income - expenses,
        savingsRate: income > 0 ? (income - expenses) / income : null,
        recurring,
        byCategory,
        bySource,
        days: dates.diffDays(c.start, c.end) + 1
    };
}

function tone(score) {
    if (score >= 80) return { label: 'Strong', tone: 'good' };
    if (score >= 65) return { label: 'Healthy', tone: 'good' };
    if (score >= 50) return { label: 'Watch closely', tone: 'warn' };
    return { label: 'Needs attention', tone: 'bad' };
}

// ---- category variance vs the user's usual, same days into the cycle ----
function categoryRows(cur, prior, dayN, budgetLimits) {
    const typical = {};
    prior.forEach(p => {
        p.txs.forEach(t => {
            if (t.type !== 'expense') return;
            if (cycles.dayOfCycle(p.start, t.transaction_date) > dayN) return;
            typical[t.category] = (typical[t.category] || 0) + amt(t) / prior.length;
        });
    });
    const cats = new Set([...Object.keys(cur.byCategory), ...Object.keys(typical)]);
    return [...cats]
        .map(cat => {
            const amount = cur.byCategory[cat] || 0;
            const usual = prior.length ? typical[cat] || 0 : null;
            const limit = budgetLimits && budgetLimits[cat] ? Number(budgetLimits[cat]) : null;
            return {
                cat,
                amount,
                usual,
                delta: usual === null ? null : amount - usual,
                deltaPct: usual && usual > 0 ? ((amount - usual) / usual) * 100 : null,
                share: cur.expenses > 0 ? amount / cur.expenses : 0,
                limit,
                limitPct: limit ? (amount / limit) * 100 : null
            };
        })
        .filter(r => r.amount > 0 || (r.usual && r.usual > 0))
        .sort((a, b) => b.amount - a.amount);
}

// ---- cumulative spend vs the user's usual cumulative path ----
function paceSeries(cur, prior, transactions, today, proj) {
    if (prior.length < 2) return null;
    const len = Math.max(cycles.expectedCycleLength(transactions), cycles.dayOfCycle(cur.start, today));
    const dayN = cycles.dayOfCycle(cur.start, today);

    const typicalDaily = new Array(len).fill(0);
    prior.forEach(p => {
        p.txs.forEach(t => {
            if (t.type !== 'expense') return;
            const d = cycles.dayOfCycle(p.start, t.transaction_date);
            if (d >= 1 && d <= len) typicalDaily[d - 1] += amt(t) / prior.length;
        });
    });
    const typical = [];
    typicalDaily.reduce((run, v, i) => (typical[i] = run + v), 0);

    const actualDaily = new Array(dayN).fill(0);
    cur.txs.forEach(t => {
        if (t.type !== 'expense') return;
        const d = cycles.dayOfCycle(cur.start, t.transaction_date);
        if (d >= 1 && d <= dayN) actualDaily[d - 1] += amt(t);
    });
    const actual = [];
    actualDaily.reduce((run, v, i) => (actual[i] = run + v), 0);

    const typicalToDate = typical[dayN - 1] ?? 0;
    const actualToDate = actual[dayN - 1] ?? 0;
    return {
        labels: Array.from({ length: len }, (_, i) => dates.addDays(cur.start, i)),
        typical,
        actual,
        dayN,
        length: len,
        typicalToDate,
        actualToDate,
        aheadBy: typicalToDate - actualToDate, // >0 = spending less than usual
        projectedEnd: proj ? proj.expensesSoFar + proj.projectedFutureSpend : null,
        typicalEnd: typical[len - 1] ?? 0
    };
}

// ---- the score ----
function score(cur, prior, allCompleted, proj, budgetLimits) {
    const comps = [];

    // 1. Savings rate (projected for a live cycle, actual for a finished one)
    if (cur.income > 0) {
        const projectedNet = cur.isCurrent && proj ? proj.projectedBalance : cur.net;
        const rate = projectedNet / cur.income;
        comps.push({
            key: 'savings',
            label: 'Savings rate',
            weight: 35,
            score: clamp((rate / SAVINGS_TARGET) * 100, 0, 100),
            headline: `${Math.round(rate * 100)}%`,
            detail: `${cur.isCurrent ? 'Projected to keep' : 'Kept'} ${Math.round(rate * 100)}% of income. A common healthy target is ${Math.round(SAVINGS_TARGET * 100)}%.`
        });
    }

    // 2. Spending stability across past cycles
    if (prior.length >= 3) {
        const totals = prior.map(p => p.expenses);
        const mean = sum(totals) / totals.length;
        const sd = Math.sqrt(sum(totals.map(v => (v - mean) ** 2)) / totals.length);
        const cv = mean > 0 ? sd / mean : 0;
        comps.push({
            key: 'stability',
            label: 'Spending stability',
            weight: 20,
            score: clamp(100 - (cv / 0.4) * 100, 0, 100),
            headline: `±${Math.round(cv * 100)}%`,
            detail: `Your cycle spending varies by about ${Math.round(cv * 100)}% around ${inr(mean)}. Steadier spending makes surprises rarer.`
        });
    }

    // 3. Budget adherence (only when limits exist)
    const limited = Object.keys(budgetLimits || {});
    if (limited.length) {
        const per = limited.map(cat => {
            const spent = cur.byCategory[cat] || 0;
            const limit = Number(budgetLimits[cat]);
            if (!limit) return 1;
            if (spent <= limit * 0.8) return 1;
            if (spent <= limit) return 0.6;
            return 0;
        });
        const over = limited.filter(cat => (cur.byCategory[cat] || 0) > Number(budgetLimits[cat])).length;
        comps.push({
            key: 'budgets',
            label: 'Budget adherence',
            weight: 15,
            score: (sum(per) / per.length) * 100,
            headline: `${limited.length - over}/${limited.length}`,
            detail:
                over === 0
                    ? `Within limit on all ${limited.length} budgeted categories.`
                    : `${over} of ${limited.length} budgeted categories are over their limit.`
        });
    }

    // 4. Fixed-cost load (only if entries are marked recurring)
    if (cur.income > 0 && cur.recurring > 0) {
        const ratio = cur.recurring / cur.income;
        comps.push({
            key: 'fixed',
            label: 'Fixed-cost load',
            weight: 15,
            score: clamp(((0.8 - ratio) / 0.3) * 100, 0, 100),
            headline: `${Math.round(ratio * 100)}%`,
            detail: `Recurring commitments take ${Math.round(ratio * 100)}% of income (${inr(cur.recurring)}). Under 50% leaves room to save.`
        });
    }

    // 5. Tracked cushion: net saved so far vs a typical cycle's spending
    if (allCompleted.length >= 3) {
        const recent = allCompleted.slice(0, HISTORY_CYCLES);
        const avgExp = sum(recent.map(p => p.expenses)) / recent.length;
        const cumNet = sum(allCompleted.map(p => p.net));
        const months = avgExp > 0 ? cumNet / avgExp : 0;
        comps.push({
            key: 'cushion',
            label: 'Tracked cushion',
            weight: 15,
            score: clamp((months / 3) * 100, 0, 100),
            headline: `${Math.max(0, months).toFixed(1)} mo`,
            detail: `Across ${allCompleted.length} finished cycles you kept ${inr(cumNet)} — about ${months.toFixed(1)} cycles of spending. Counts only what you have tracked; 3–6 is a common safety goal.`
        });
    }

    if (!comps.length) return null;
    const totalW = sum(comps.map(c => c.weight));
    const value = Math.round(sum(comps.map(c => c.score * c.weight)) / totalW);
    return {
        value,
        ...tone(value),
        components: comps,
        confidence: comps.length >= 4 && prior.length >= 3 ? 'good' : comps.length >= 3 ? 'fair' : 'low',
        basedOn: prior.length
    };
}

// ---- ranked, quantified actions (live cycle only) ----
function recommendations(cur, prior, rows, proj, pace, budgetLimits) {
    const out = [];
    const push = r => out.push(r);
    const sev = { high: 0, medium: 1, info: 2, good: 3 };
    const daysLeft = proj ? proj.daysRemaining : 0;

    if (cur.income > 0 && proj) {
        if (proj.projectedBalance < 0) {
            const perDay = daysLeft > 0 ? Math.abs(proj.projectedBalance) / daysLeft : null;
            push({
                id: 'deficit',
                severity: 'high',
                title: `On track to overspend by ${inr(proj.projectedBalance)}`,
                detail:
                    perDay !== null
                        ? `At your current pattern the cycle ends short. Spending about ${inr(perDay)} a day less than now for the last ${daysLeft} days closes the gap.`
                        : 'The cycle is ending short of income.',
                impact: Math.abs(proj.projectedBalance)
            });
        } else {
            const target = cur.income * SAVINGS_TARGET;
            if (proj.projectedBalance < target) {
                const gap = target - proj.projectedBalance;
                push({
                    id: 'savings-gap',
                    severity: 'medium',
                    title: `${inr(gap)} short of a ${Math.round(SAVINGS_TARGET * 100)}% savings rate`,
                    detail:
                        daysLeft > 0
                            ? `You're projected to keep ${inr(proj.projectedBalance)}. Reaching ${inr(target)} means saving about ${inr(gap / daysLeft)} more per remaining day.`
                            : `You kept ${inr(proj.projectedBalance)} against a ${inr(target)} target.`,
                    impact: gap
                });
            }
        }
    }

    // Biggest categories running above the user's own usual pace
    rows.filter(r => r.delta !== null && r.delta >= 500 && (r.deltaPct === null || r.deltaPct >= 15))
        .slice(0, 5)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 2)
        .forEach(r =>
            push({
                id: `cat-${r.cat}`,
                severity: 'medium',
                title:
                    r.deltaPct === null
                        ? `${r.cat} is new: ${inr(r.amount)} this cycle`
                        : `${r.cat} is ${inr(r.delta)} above your usual pace`,
                detail:
                    r.deltaPct === null
                        ? `You have not spent on ${r.cat} in your previous cycles, so this is ${inr(r.amount)} of unplanned spending. A one-off, or a new habit to budget for?`
                        : `${inr(r.amount)} so far versus about ${inr(r.usual)} by this point in an average cycle (+${Math.round(r.deltaPct)}%). Bringing it back to normal protects ${inr(r.delta)}.`,
                impact: r.delta
            })
        );

    // Weekend skew over the last ~3 cycles
    const recentExpenses = [cur, ...prior.slice(0, 2)].flatMap(s => s.txs.filter(t => t.type === 'expense'));
    if (recentExpenses.length >= 15) {
        const w = projection.weekendWeekdayStats(recentExpenses);
        if (w.weekendDays >= 4 && w.weekdayDays >= 8 && w.weekendAvg >= w.weekdayAvg * 1.6) {
            const perCycle = ((w.weekendAvg - w.weekdayAvg) * (cur.days * 2)) / 7;
            push({
                id: 'weekend',
                severity: 'info',
                title: 'Weekend days cost you far more',
                detail: `You spend ${inr(w.weekendAvg)} on an average weekend day versus ${inr(w.weekdayAvg)} on a weekday. Closing half that gap frees roughly ${inr(perCycle / 2)} per cycle.`,
                impact: perCycle / 2
            });
        }
    }

    // Many small purchases
    const small = cur.txs.filter(t => t.type === 'expense' && !t.is_recurring && amt(t) < SMALL_SPEND);
    const smallTotal = sum(small.map(amt));
    if (small.length >= 12 && cur.expenses > 0 && smallTotal / cur.expenses >= 0.08 && smallTotal >= 500) {
        push({
            id: 'small',
            severity: 'info',
            title: `${small.length} small purchases add up to ${inr(smallTotal)}`,
            detail: `Each is under ${inr(SMALL_SPEND)}, together ${Math.round((smallTotal / cur.expenses) * 100)}% of this cycle's spending. Trimming a third of them frees about ${inr(smallTotal / 3)}.`,
            impact: smallTotal / 3
        });
    }

    // Credit-card money already spent
    const card = cur.bySource['credit-card'] || 0;
    if (card > 0) {
        push({
            id: 'cards',
            severity: card > cur.income * 0.4 && cur.income > 0 ? 'medium' : 'info',
            title: `${inr(card)} is on credit cards this cycle`,
            detail: 'That money is already spent, but your bank balance does not show it yet. Set it aside so next cycle does not start in debt.',
            impact: card
        });
    }

    // No budgets yet
    if (!Object.keys(budgetLimits || {}).length && prior.length >= 2 && rows.length) {
        const top = rows
            .slice(0, 3)
            .map(r => r.cat)
            .join(', ');
        push({
            id: 'no-budgets',
            severity: 'info',
            title: 'Set limits for your biggest categories',
            detail: `${top} lead your spending. Budgets turn those into early warnings — add them on the Budgets tab.`,
            impact: null
        });
    }

    // Good news
    if (pace && pace.aheadBy >= 500 && (!proj || proj.projectedBalance >= 0)) {
        push({
            id: 'ahead',
            severity: 'good',
            title: `${inr(pace.aheadBy)} under your usual pace`,
            detail: `You've spent ${inr(pace.actualToDate)} by day ${pace.dayN}; an average cycle is at ${inr(pace.typicalToDate)} by now. Keep it up.`,
            impact: pace.aheadBy
        });
    }

    return out
        .sort((a, b) => sev[a.severity] - sev[b.severity] || (b.impact || 0) - (a.impact || 0))
        .slice(0, 5);
}

// cycleIndex: 0 = newest (current). budgetLimits: { category: limit }.
function analyze({ transactions, today, cycleIndex = 0, budgetLimits = {} }) {
    const list = cycles.deriveCycles(transactions, today);
    const chosen = list[Math.min(cycleIndex, list.length - 1)];
    if (!chosen) return { status: 'empty' };

    const cur = summarize(transactions, chosen);
    const older = list
        .slice(list.indexOf(chosen) + 1)
        .filter(c => !c.fallback)
        .map(c => summarize(transactions, c))
        .filter(s => s.income > 0 || s.expenses > 0);
    const prior = older.slice(0, HISTORY_CYCLES);

    const proj =
        cur.isCurrent && !cur.fallback ? projection.projectCycle(transactions, cur.start, today) : null;
    const dayN = cur.isCurrent ? cycles.dayOfCycle(cur.start, today) : cur.days;
    const rows = categoryRows(cur, prior, dayN, budgetLimits);
    const pace = cur.isCurrent ? paceSeries(cur, prior, transactions, today, proj) : null;
    const health = score(cur, prior, older, proj, budgetLimits);
    const actions = cur.isCurrent ? recommendations(cur, prior, rows, proj, pace, budgetLimits) : [];

    // Income vs spending for the last cycles, oldest first (trend chart)
    const trend = [cur, ...prior]
        .slice(0, 8)
        .reverse()
        .map(s => ({ start: s.start, income: s.income, expenses: s.expenses, current: s.isCurrent }));

    return {
        status: 'ok',
        cycle: { start: cur.start, end: cur.end, isCurrent: cur.isCurrent, dayN, days: cur.days },
        totals: { income: cur.income, expenses: cur.expenses, net: cur.net, savingsRate: cur.savingsRate },
        priorCount: prior.length,
        health,
        rows,
        pace,
        actions,
        trend,
        cards: {
            spent: cur.bySource['credit-card'] || 0,
            share: cur.expenses > 0 ? (cur.bySource['credit-card'] || 0) / cur.expenses : 0
        },
        projection: proj
    };
}

export default { analyze, summarize, categoryRows, paceSeries, score, recommendations, inr };
