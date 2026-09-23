// InsightsPage — React port of the "Financial Insights" page's
// generateLocalAIInsights(). Read-only: no mutations, so unlike
// AccountsPage there's no shared-state resync to worry about. But it
// consumes the same cycle-selection state the still-vanilla Dashboard
// owns (this.transactions/currentCycleStart/currentCycleEnd/
// givingFloorCategory on window.app) — Insights doesn't have its own
// copy of that state yet, so it reads window.app at analyze-time, same
// as the original did via `this.transactions` etc. This coupling goes
// away once Dashboard is ported and shared state has a real owner.
//
// The 7-section calculation logic (anomalies, run-rate, leak, macro,
// weekend/weekday, month-over-month) is copied field-for-field from the
// original — see git history for src/main.js's generateLocalAIInsights
// if the numbers here are ever in question. Simeon: please spot-check
// the actual analysis output against the pre-port version once, since
// this is financial-analysis logic, not just UI.
import { useState } from 'react';
import PFDates from '../../engine/dates.js';
import PFCycles from '../../engine/cycles.js';
import PFProjection from '../../engine/projection.js';

interface Transaction {
    id: number;
    type: 'income' | 'expense';
    amount: number | string;
    category: string;
    transaction_date: string;
}

interface AppState {
    transactions: Transaction[];
    currentCycleStart: string | null;
    currentCycleEnd: string | null;
    givingFloorCategory: string;
}

function omitGivingCategory(
    spendMap: Record<string, number>,
    givingFloorCategory: string
): Record<string, number> {
    if (!givingFloorCategory || !(givingFloorCategory in spendMap)) return spendMap;
    const rest = { ...spendMap };
    delete rest[givingFloorCategory];
    return rest;
}

type Insights =
    | { status: 'need-more-data' }
    | {
          status: 'ok';
          historicalTxs: Transaction[];
          historicalMonths: number;
          anomalies: { cat: string; currentAmt: number; histAvg: number; diff: number; pct: number }[];
          income: number;
          expenses: number;
          dailyBurnRate: number;
          daysRemaining: number;
          projectedBalance: number;
          topSpender: [string, number] | null;
          savingsRate: string;
          paretoRatio: string;
          sortedCategoriesCount: number;
          expenseTxsCount: number;
          weekendAvg: number;
          weekdayAvg: number;
          cycleExpenses: { label: string; total: number; start: string }[];
          currentStart: string;
      };

function computeInsights(app: AppState): Insights {
    const allTxs = app.transactions || [];
    const currentStart = app.currentCycleStart;
    const currentEnd = app.currentCycleEnd;

    const currentTxs: Transaction[] = currentStart
        ? PFCycles.transactionsInCycle(allTxs, currentStart, currentEnd ?? PFDates.todayStr())
        : [];
    const historicalTxs = currentStart ? allTxs.filter(t => t.transaction_date < currentStart) : [];

    if (!currentStart || currentTxs.length < 3) return { status: 'need-more-data' };

    let income = 0,
        expenses = 0;
    const currentSpend: Record<string, number> = {};

    currentTxs.forEach(t => {
        const amount = Number(t.amount);
        if (t.type === 'income') income += amount;
        if (t.type === 'expense') {
            expenses += amount;
            currentSpend[t.category] = (currentSpend[t.category] || 0) + amount;
        }
    });

    const today = PFDates.todayStr();

    const historicalMonthsVal = PFProjection.historicalMonths(allTxs, currentStart);
    const historicalSpend = PFProjection.spendByCategory(historicalTxs);
    const anomalies =
        historicalTxs.length > 0
            ? PFProjection.computeAnomalies(
                  omitGivingCategory(currentSpend, app.givingFloorCategory),
                  historicalSpend,
                  historicalMonthsVal
              )
            : [];

    const proj = PFProjection.projectCycle(allTxs, currentStart, today);
    const { dailyBurnRate, daysRemaining, projectedBalance } = proj;

    const sortedCategories = Object.entries(currentSpend).sort((a, b) => b[1] - a[1]);
    const topSpender = sortedCategories.length > 0 ? (sortedCategories[0] ?? null) : null;

    let top3Spend = 0;
    sortedCategories.slice(0, 3).forEach(c => (top3Spend += c[1]));
    const paretoRatio = expenses > 0 ? ((top3Spend / expenses) * 100).toFixed(0) : '0';
    const savingsRate = income > 0 ? (((income - expenses) / income) * 100).toFixed(0) : '0';

    const expenseTxs = allTxs.filter(t => t.type === 'expense');
    const { weekendAvg, weekdayAvg } = PFProjection.weekendWeekdayStats(expenseTxs);

    const cycleExpenses = PFProjection.cycleExpenseTotals(allTxs, today).map(
        (c: { start: string; end: string; total: number }) => ({
            label: PFDates.parseLocal(c.start).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short'
            }),
            total: c.total,
            start: c.start
        })
    );

    return {
        status: 'ok',
        historicalTxs,
        historicalMonths: historicalMonthsVal,
        anomalies,
        income,
        expenses,
        dailyBurnRate,
        daysRemaining,
        projectedBalance,
        topSpender,
        savingsRate,
        paretoRatio,
        sortedCategoriesCount: sortedCategories.length,
        expenseTxsCount: expenseTxs.length,
        weekendAvg,
        weekdayAvg,
        cycleExpenses,
        currentStart
    };
}

function Section({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
    return (
        <div className="insight-section">
            <div className="insight-section-header">
                <span className="insight-num">{num}</span>
                <h4>{title}</h4>
            </div>
            <div className="insight-content">{children}</div>
        </div>
    );
}

export default function InsightsPage() {
    const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');
    const [insights, setInsights] = useState<Insights | null>(null);

    function analyze() {
        setPhase('loading');
        // Matches the original's artificial delay (perceived "crunching").
        setTimeout(() => {
            const app = window.app as unknown as AppState | undefined;
            setInsights(
                computeInsights(
                    app ?? {
                        transactions: [],
                        currentCycleStart: null,
                        currentCycleEnd: null,
                        givingFloorCategory: ''
                    }
                )
            );
            setPhase('done');
        }, 800);
    }

    return (
        <div className="ai-container">
            <div className="ai-card">
                <div className="ai-card-icon">🤖</div>
                <h3>Analyze My Spending</h3>
                <p>
                    Scans your historical transactions across 7 dimensions — anomalies, run-rate, leaks, macro
                    analytics, weekend patterns, and month-over-month trends.
                </p>
                <button className="btn btn-ai" onClick={analyze}>
                    🔍 Analyze Historical Data
                </button>
                {phase === 'loading' && (
                    <div className="ai-loading">
                        <span className="status-dot connecting"></span> Crunching your numbers...
                    </div>
                )}
            </div>
            {phase === 'done' && insights && (
                <div className="ai-result">
                    <InsightsResult insights={insights} />
                </div>
            )}
        </div>
    );
}

function InsightsResult({ insights }: { insights: Insights }) {
    if (insights.status === 'need-more-data') {
        return (
            <p className="ai-empty">
                Log a few more transactions in this cycle before I can run a full audit.
            </p>
        );
    }

    const {
        historicalTxs,
        historicalMonths,
        anomalies,
        income,
        expenses,
        dailyBurnRate,
        daysRemaining,
        projectedBalance,
        topSpender,
        savingsRate,
        paretoRatio,
        sortedCategoriesCount,
        expenseTxsCount,
        weekendAvg,
        weekdayAvg,
        cycleExpenses,
        currentStart
    } = insights;

    const rateOk = Number(savingsRate) >= 20;
    const higherDay = weekendAvg > weekdayAvg ? 'weekends' : 'weekdays';
    const dayRatio =
        weekendAvg > 0 && weekdayAvg > 0
            ? Math.max(weekendAvg, weekdayAvg) / Math.min(weekendAvg, weekdayAvg)
            : 1;

    const maxCycleVal = cycleExpenses.length ? Math.max(...cycleExpenses.map(c => c.total)) : 0;
    const recent = cycleExpenses.length ? (cycleExpenses[cycleExpenses.length - 1]?.total ?? 0) : 0;
    const prev = cycleExpenses.length > 1 ? (cycleExpenses[cycleExpenses.length - 2]?.total ?? 0) : 0;
    const momChange = prev > 0 ? (((recent - prev) / prev) * 100).toFixed(1) : '0';
    const isUp = recent > prev;
    // cycleExpenses is oldest-first (needed for the recent/prev trend math
    // above, unchanged). With ~a year of cycles the bar chart used to open
    // on the oldest month with no way to scroll to anything recent —
    // reversing only the display order puts the current/most-recent
    // cycles first, so they're visible without scrolling.
    const chartCycles = [...cycleExpenses].reverse();

    return (
        <div className="insights-body">
            {/* 1. The Audit */}
            <Section num="01" title="The Audit">
                {historicalTxs.length === 0 ? (
                    <p className="insight-muted">
                        Baseline comparison requires at least one prior cycle. Keep logging data.
                    </p>
                ) : anomalies.length === 0 ? (
                    <div className="insight-badge insight-badge--green">
                        ✅ No significant overspending detected against your {historicalMonths.toFixed(1)}
                        -month baseline.
                    </div>
                ) : (
                    <>
                        <p className="insight-muted" style={{ marginBottom: 10 }}>
                            Variances against your {historicalMonths.toFixed(1)}-month average:
                        </p>
                        {anomalies.map(a => (
                            <div className="insight-anomaly-row" key={a.cat}>
                                <div className="insight-anomaly-header">
                                    <strong>{a.cat}</strong>
                                    <span className="insight-pill insight-pill--red">
                                        +{a.pct.toFixed(0)}%
                                    </span>
                                </div>
                                <div className="insight-anomaly-values">
                                    Current: <b>₹{a.currentAmt.toFixed(0)}</b> &nbsp;·&nbsp; Avg:{' '}
                                    <b>₹{a.histAvg.toFixed(0)}</b>
                                    <span className="insight-pill--delta">+₹{a.diff.toFixed(0)}</span>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </Section>

            {/* 2. Corrective Measures */}
            <Section num="02" title="Corrective Measures">
                {anomalies.length === 0 ? (
                    <p className="insight-muted">
                        No immediate corrections required. Maintain current trajectory.
                    </p>
                ) : (
                    anomalies.slice(0, 2).map((a, i) => (
                        <div className="insight-action-row" key={a.cat}>
                            <div className="insight-action-label">
                                Action {i + 1}: Re-peg {a.cat}
                            </div>
                            <div className="insight-action-body">
                                Target ₹<b>{(a.histAvg * 0.95).toFixed(0)}</b> next cycle (5% below baseline)
                                to offset the ₹{a.diff.toFixed(0)} variance.
                            </div>
                        </div>
                    ))
                )}
            </Section>

            {/* 3. Run-Rate Status */}
            <Section num="03" title="Run-Rate Status">
                {projectedBalance < 0 ? (
                    <div className="insight-badge insight-badge--red">
                        🚨 Deficit Projected — burning ₹{dailyBurnRate.toFixed(0)}/day. Short by{' '}
                        <b>₹{Math.abs(projectedBalance).toFixed(0)}</b>. Freeze non-essential spending.
                    </div>
                ) : projectedBalance < income * 0.1 ? (
                    <div className="insight-badge insight-badge--amber">
                        ⚠️ Low Margins — ₹{projectedBalance.toFixed(0)} leftover. Reduce to ₹
                        <b>{((income * 0.9 - expenses) / (daysRemaining || 1)).toFixed(0)}</b>/day.
                    </div>
                ) : (
                    <div className="insight-badge insight-badge--green">
                        ✅ Surplus Projected — controlled burn of ₹{dailyBurnRate.toFixed(0)}/day. On track
                        for <b>+₹{projectedBalance.toFixed(0)}</b>.
                    </div>
                )}
            </Section>

            {/* 4. Target the Leak */}
            <Section num="04" title="Target the Leak">
                {topSpender && expenses > 0 ? (
                    <>
                        <div className="insight-leak-row">
                            <div className="insight-leak-label">{topSpender[0]}</div>
                            <div className="insight-leak-pct">
                                {((topSpender[1] / expenses) * 100).toFixed(1)}% of outflow
                            </div>
                            <div className="insight-leak-amount">₹{topSpender[1].toFixed(0)}</div>
                        </div>
                        <p className="insight-muted" style={{ marginTop: 10 }}>
                            Directive: Institute a 48-hour cooling-off period for this category.
                        </p>
                    </>
                ) : (
                    <p className="insight-muted">No dominant leaks detected.</p>
                )}
            </Section>

            {/* 5. Macro Analytics */}
            <Section num="05" title="Macro Analytics">
                <div className="insight-macro-grid">
                    {income > 0 && (
                        <div className="insight-macro-tile">
                            <div
                                className="insight-macro-val"
                                style={{ color: rateOk ? 'var(--income)' : 'var(--expense)' }}
                            >
                                {savingsRate}%
                            </div>
                            <div className="insight-macro-label">Savings Rate</div>
                            <div className="insight-macro-note">
                                {rateOk ? 'Above 20% benchmark' : 'Below 20% benchmark'}
                            </div>
                        </div>
                    )}
                    {expenses > 0 && sortedCategoriesCount > 3 && (
                        <div className="insight-macro-tile">
                            <div className="insight-macro-val">{paretoRatio}%</div>
                            <div className="insight-macro-label">Top 3 Concentration</div>
                            <div className="insight-macro-note">Focus cuts here for max impact</div>
                        </div>
                    )}
                </div>
            </Section>

            {/* 6. Weekend vs Weekday */}
            <Section num="06" title="Weekend vs Weekday">
                {expenseTxsCount < 5 ? (
                    <p className="insight-muted">Need more transactions to detect patterns.</p>
                ) : (
                    <>
                        <div className="insight-day-grid">
                            <div className="insight-day-tile">
                                <div className="insight-day-val">₹{weekdayAvg.toFixed(0)}</div>
                                <div className="insight-day-label">avg/weekday</div>
                            </div>
                            <div className="insight-day-tile insight-day-tile--alt">
                                <div className="insight-day-val">₹{weekendAvg.toFixed(0)}</div>
                                <div className="insight-day-label">avg/weekend day</div>
                            </div>
                        </div>
                        <p className="insight-muted" style={{ marginTop: 10 }}>
                            You spend <b>{dayRatio.toFixed(1)}×</b> more on {higherDay}.{' '}
                            {weekendAvg > weekdayAvg * 1.5
                                ? 'Weekend spending is a significant driver — cap weekend activities.'
                                : 'Spending is fairly even across the week.'}
                        </p>
                    </>
                )}
            </Section>

            {/* 7. Month-over-Month */}
            <Section num="07" title="Month-over-Month">
                {cycleExpenses.length < 2 ? (
                    <p className="insight-muted">Need at least 2 salary cycles to show a trend.</p>
                ) : (
                    <>
                        <div
                            className={`insight-badge ${isUp ? 'insight-badge--red' : 'insight-badge--green'}`}
                            style={{ marginBottom: 14 }}
                        >
                            {isUp ? '📈' : '📉'} vs last cycle:{' '}
                            <b>
                                {isUp ? '+' : ''}
                                {momChange}%
                            </b>{' '}
                            (₹
                            {recent.toFixed(0)} vs ₹{prev.toFixed(0)})
                        </div>
                        <p className="insight-muted" style={{ marginBottom: 8 }}>
                            Most recent cycle first — scroll to see further back.
                        </p>
                        <div className="insight-bar-chart">
                            {chartCycles.map(c => {
                                const barHeight =
                                    maxCycleVal > 0 ? Math.max(4, (c.total / maxCycleVal) * 70) : 4;
                                const isCurrent = c.start === currentStart;
                                return (
                                    <div className="insight-bar-col" key={c.start}>
                                        <div className="insight-bar-val">₹{(c.total / 1000).toFixed(1)}k</div>
                                        <div
                                            className={`insight-bar-fill ${isCurrent ? 'insight-bar-fill--active' : ''}`}
                                            style={{ height: `${barHeight}px` }}
                                        ></div>
                                        <div className="insight-bar-label">
                                            {c.label}
                                            {isCurrent && <span className="insight-bar-current-dot" />}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </Section>
        </div>
    );
}
