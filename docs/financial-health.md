# Financial health, pace and actions

Implemented in `src/engine/health.js` (pure functions, covered by
`tests/engine/health.test.js`) and rendered by
`src/react/pages/dashboard/HealthPanels.tsx`.

## Principles

1. **Your data only.** Everything is derived from the entries you track. It is
   an estimate, not financial advice, and the UI says so.
2. **No guessing.** A score component with too little data is *left out* and
   the score re-weights over the rest. Nothing is filled with a default.
3. **Fair comparisons.** "Usual" is the average of your previous completed
   salary cycles (up to 6), measured over the *same number of days into the
   cycle*. A half-finished cycle is never compared with a finished one.
4. **Every action shows its evidence and a rupee impact.**

## The score (0–100)

Weighted average of the components that have data. Labels: 80+ Strong,
65–79 Healthy, 50–64 Watch closely, below 50 Needs attention.

| Component | Weight | Needs | Scoring |
|---|---|---|---|
| Savings rate | 35 | income this cycle | rate ÷ 20% target, capped 0–100. Current cycle uses the **projected** end-of-cycle balance; a finished cycle uses actuals |
| Spending stability | 20 | ≥3 previous cycles | 100 − (coefficient of variation ÷ 40%) × 100 |
| Budget adherence | 15 | ≥1 budget limit set | per category: ≤80% of limit = full, ≤100% = 0.6, over = 0 |
| Fixed-cost load | 15 | income and entries marked *recurring* | recurring ÷ income: ≤50% full, ≥80% zero |
| Tracked cushion | 15 | ≥3 finished cycles | (total net kept ÷ average cycle spending) ÷ 3 months, capped. Counts **only what you have tracked** |

Confidence is *good* with ≥4 components and ≥3 previous cycles, *fair* with
≥3 components, otherwise *low*.

## What to do next

Ranked by severity (Act now → Worth fixing → Good to know → Going well), then
rupee impact; the top five are shown. Only for the current cycle.

| Action | Trigger |
|---|---|
| Projected overspend | projected balance < 0; shows the daily reduction needed for the remaining days |
| Savings-rate gap | projected balance below 20% of income |
| Category above usual | ≥₹500 and ≥15% above your usual at this point in the cycle, or a brand-new category with ≥₹500 |
| Weekend skew | weekend average per spending day ≥1.6× weekday, over the last ~3 cycles |
| Many small purchases | ≥12 non-recurring purchases under ₹200 and ≥8% of the cycle's spending |
| Credit-card spend | any spend on the credit-card source this cycle — money already spent but not yet in the bank balance |
| No budgets | none set and ≥2 previous cycles |
| Under your usual pace | ≥₹500 below the typical cumulative spend and not projected to overspend |

## Pace chart

Cumulative spend by cycle day: *your usual* (average of previous cycles),
*this cycle*, and a dashed *projected* endpoint (spent so far + projected
remaining spend). Needs ≥2 previous cycles.

## Assumptions and limits

- Salary cycles come from transactions whose category contains "salary".
  Without any, the app falls back to the calendar month and history-based
  parts stay empty.
- A "credit-card" payment source is treated as a liability to settle later.
- Recurring detection relies on the *recurring* flag you set.
- The cushion assumes your tracked entries reflect all money in and out.
