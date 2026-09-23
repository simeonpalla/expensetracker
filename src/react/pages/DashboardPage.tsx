// DashboardPage — React port of the vanilla Dashboard: cycle selection,
// summary stats, budget/giving-floor warnings, predictive run-rate card,
// a new OLS spending forecast, the daily/source charts, and the
// transaction list (with its own edit/delete click handling and native
// swipe-to-delete).
//
// Bridges to the still-vanilla app:
//  - Reads window.app.transactions/categories at mount and on every
//    notifyTransactionsChanged()/notifyCategoriesChanged() (main.js calls
//    the former after any add/edit/delete; CategoriesPage.tsx the
//    latter) — same crossPageSync pattern every other React page uses.
//  - Writes window.app.currentCycleStart/currentCycleEnd whenever the
//    selected cycle changes, since InsightsPage.tsx and BudgetsPage.tsx
//    still read those two fields directly off the vanilla instance.
//  - Calls window.app.openEditModalById(id)/deleteTransaction(id) for
//    row actions — the edit/delete modals themselves stay 100% vanilla,
//    untouched by this port.
//  - Reads window.app.budgetLimits/givingFloorPct/givingFloorCategory
//    (BudgetsPage.tsx owns writing these) for the warning cards.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PFDates from '../../engine/dates.js';
import PFCycles from '../../engine/cycles.js';
import PFProjection from '../../engine/projection.js';
import PFHealth from '../../engine/health.js';
import {
    ActionList,
    CategoryTable,
    HealthHero,
    PaceChart,
    TrendChart,
    type Analysis
} from './dashboard/HealthPanels';
import { loadChart } from '../../charts.js';
import { showNotification } from '../../ui.js';
import { onCategoriesChanged, onSettingsChanged, onTransactionsChanged } from '../crossPageSync';

interface Transaction {
    id: number | string;
    type: 'income' | 'expense';
    amount: number | string;
    category: string;
    transaction_date: string;
    payment_to?: string | null;
    payment_source?: string | null;
    source_details?: string | null;
    description?: string | null;
    is_recurring?: boolean;
}

interface Category {
    name: string;
    icon?: string;
}

// RFC 4180: quote cells containing commas/quotes/newlines and double
// embedded quotes. Cells starting with formula characters get a leading
// apostrophe (CSV injection guard) — copied unchanged from the retired
// vanilla exportCSV().
function csvCell(v: unknown): string {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}

// A category deliberately pegged to a % of income (the giving floor) is
// *supposed* to grow when income grows — not an overspending anomaly.
function omitGivingCategory(
    spendMap: Record<string, number>,
    givingFloorCategory: string
): Record<string, number> {
    if (!givingFloorCategory || !(givingFloorCategory in spendMap)) return spendMap;
    const rest = { ...spendMap };
    delete rest[givingFloorCategory];
    return rest;
}

const money = (n: number) =>
    `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function niceDate(d: string) {
    return PFDates.parseLocal(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function DashboardPage() {
    const [transactions, setTransactions] = useState<Transaction[]>(() => window.app?.transactions ?? []);
    const [categories, setCategories] = useState<Category[]>(() => window.app?.categories ?? []);
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [filterType, setFilterType] = useState('');
    const [filterCategory, setFilterCategory] = useState('');
    const [chartView, setChartView] = useState<{ mode: 'source' | 'category'; source?: string }>({
        mode: 'source'
    });

    // Budgets/giving floor live on window.app and change without the
    // transaction/category arrays changing; bumping this re-runs the memos
    // that read them.
    const [settingsVersion, setSettingsVersion] = useState(0);

    const refresh = useCallback(() => {
        setTransactions(window.app?.transactions ?? []);
        setCategories(window.app?.categories ?? []);
        setSettingsVersion(v => v + 1);
    }, []);

    useEffect(() => {
        const offTx = onTransactionsChanged(refresh);
        const offCat = onCategoriesChanged(refresh);
        const offSettings = onSettingsChanged(refresh);
        return () => {
            offTx();
            offCat();
            offSettings();
        };
    }, [refresh]);

    const today = PFDates.todayStr();
    const cycles = useMemo(() => PFCycles.deriveCycles(transactions, today), [transactions, today]);
    const cycle = cycles[Math.min(selectedIdx, cycles.length - 1)] ?? cycles[0];

    useEffect(() => {
        if (window.app && cycle) {
            window.app.currentCycleStart = cycle.start;
            window.app.currentCycleEnd = cycle.end;
        }
    }, [cycle]);

    const cycleTxs: Transaction[] = useMemo(
        () => (cycle ? PFCycles.transactionsInCycle(transactions, cycle.start, cycle.end) : []),
        [transactions, cycle]
    );

    const { income, expenses } = useMemo(() => {
        let inc = 0,
            exp = 0;
        cycleTxs.forEach(t => {
            if (t.type === 'income') inc += Number(t.amount);
            if (t.type === 'expense') exp += Number(t.amount);
        });
        return { income: inc, expenses: exp };
    }, [cycleTxs]);
    const balance = income - expenses;

    const streak = useMemo(
        () =>
            cycle
                ? PFCycles.noSpendStreak(cycleTxs, cycle.start, today)
                : { currentStreak: 0, bestStreak: 0 },
        [cycleTxs, cycle, today]
    );

    const historicalTxs: Transaction[] = useMemo(
        () => (cycle ? transactions.filter(t => t.transaction_date < cycle.start) : []),
        [transactions, cycle]
    );

    // ---- predictive run-rate + top leak ----
    const proj = useMemo(
        () => (cycle ? PFProjection.projectCycle(transactions, cycle.start, today) : null),
        [transactions, cycle, today]
    );

    const leak = useMemo(() => {
        if (!cycle || historicalTxs.length === 0) return null;
        const currentSpend: Record<string, number> = {};
        cycleTxs.forEach(t => {
            if (t.type === 'expense')
                currentSpend[t.category] = (currentSpend[t.category] || 0) + Number(t.amount);
        });
        const months = PFProjection.historicalMonths(transactions, cycle.start);
        const anomalies = PFProjection.computeAnomalies(
            omitGivingCategory(currentSpend, window.app?.givingFloorCategory ?? ''),
            PFProjection.spendByCategory(historicalTxs),
            months
        );
        return anomalies[0] ?? null;
    }, [cycle, cycleTxs, historicalTxs, transactions]);

    // ---- budget warnings ----
    const budgetWarnings = useMemo(() => {
        const limits = window.app?.budgetLimits ?? {};
        const spend: Record<string, number> = {};
        cycleTxs.forEach(t => {
            if (t.type === 'expense') spend[t.category] = (spend[t.category] || 0) + Number(t.amount);
        });
        return Object.entries(limits)
            .map(([cat, limit]) => {
                const spent = spend[cat] || 0;
                const pct = limit > 0 ? (spent / limit) * 100 : 0;
                if (pct < 80) return null;
                const icon = categories.find(c => c.name === cat)?.icon ?? '📁';
                return { cat, icon, spent, limit, pct: Math.min(pct, 100), over: pct > 100 };
            })
            .filter((w): w is NonNullable<typeof w> => w !== null);
    }, [cycleTxs, categories, settingsVersion]);

    // ---- giving floor warning ----
    const givingFloorWarning = useMemo(() => {
        const cat = window.app?.givingFloorCategory ?? '';
        const floorPct = window.app?.givingFloorPct ?? 5;
        if (income <= 0 || !cat) return null;
        const target = cat.trim().toLowerCase();
        const given = cycleTxs
            .filter(t => t.type === 'expense' && t.category.trim().toLowerCase() === target)
            .reduce((s, t) => s + Number(t.amount), 0);
        const floor = income * (floorPct / 100);
        if (given >= floor) return null;
        const pct = floor > 0 ? (given / floor) * 100 : 100;
        const icon = categories.find(c => c.name === cat)?.icon ?? '🙏';
        return { cat, icon, given, shortBy: floor - given, pct: Math.min(pct, 100), floorPct };
    }, [cycleTxs, categories, income, settingsVersion]);

    // ---- OLS spending forecast ----
    const forecast = useMemo(() => {
        const totals = PFProjection.cycleExpenseTotals(transactions, today);
        // Last entry is the current, still-partial cycle — exclude it from
        // the regression basis so an in-progress cycle doesn't skew the
        // trend, but keep it for display context.
        const completed =
            totals.length > 0 && totals[totals.length - 1]?.start === cycle?.start
                ? totals.slice(0, -1)
                : totals;
        if (completed.length < 4) return null;
        const values = completed.map(c => c.total);
        const { slope, intercept } = PFProjection.linearRegression(values);
        const predicted = Math.max(0, slope * values.length + intercept);
        const recent = completed.slice(-6);
        return { recent, predicted, slope, cycleLength: PFCycles.expectedCycleLength(transactions) };
    }, [transactions, today, cycle]);

    // ---- filters + transaction list ----
    const filtered = useMemo(
        () =>
            cycleTxs
                .filter(t => !filterType || t.type === filterType)
                .filter(t => !filterCategory || t.category === filterCategory)
                .slice()
                .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date)),
        [cycleTxs, filterType, filterCategory]
    );

    function handleEdit(id: Transaction['id']) {
        window.app?.openEditModalById?.(id);
    }
    function handleDelete(id: Transaction['id']) {
        window.app?.deleteTransaction?.(id);
    }

    function exportCSV() {
        if (!cycleTxs.length) {
            showNotification('No transactions to export.', 'error');
            return;
        }
        const headers = [
            'Date',
            'Type',
            'Category',
            'Amount',
            'Payment To',
            'Payment Source',
            'Bank/Card',
            'Description',
            'Recurring'
        ];
        const rows = cycleTxs.map(t =>
            [
                t.transaction_date,
                t.type,
                t.category,
                Number(t.amount),
                t.payment_to || '',
                t.payment_source || '',
                t.source_details || '',
                t.description || '',
                t.is_recurring ? 'Yes' : 'No'
            ]
                .map(csvCell)
                .join(',')
        );
        const csv = [headers.join(','), ...rows].join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `expenses_${cycle?.start}_to_${cycle?.end}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification('CSV exported!');
    }

    // ---- charts ----
    const lineCanvasRef = useRef<HTMLCanvasElement>(null);
    const donutCanvasRef = useRef<HTMLCanvasElement>(null);
    const forecastCanvasRef = useRef<HTMLCanvasElement>(null);
    const lineChartRef = useRef<{ destroy: () => void } | null>(null);
    const donutChartRef = useRef<{ destroy: () => void } | null>(null);
    const forecastChartRef = useRef<{ destroy: () => void } | null>(null);

    useEffect(() => {
        if (!cycle) return;
        let cancelled = false;
        (async () => {
            const chartEnd = cycle.end < today ? cycle.end : today;
            const days = PFDates.eachDay(cycle.start, chartEnd);
            const labels = days.map(niceDate);
            const dailyData: Record<string, number> = {};
            days.forEach(d => {
                dailyData[d] = 0;
            });
            cycleTxs.forEach(t => {
                const existing = dailyData[t.transaction_date];
                if (t.type === 'expense' && existing !== undefined) {
                    dailyData[t.transaction_date] = existing + Number(t.amount);
                }
            });
            const expenseSeries = days.map(d => dailyData[d] ?? 0);
            const trend = PFProjection.linearRegression(expenseSeries).trend;

            const Chart = await loadChart();
            if (cancelled || !lineCanvasRef.current) return;
            lineChartRef.current?.destroy();
            lineChartRef.current = new Chart(lineCanvasRef.current.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Daily Expenses',
                            data: expenseSeries,
                            borderColor: '#ff5c72',
                            backgroundColor: 'rgba(255,92,114,0.08)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 3,
                            pointBackgroundColor: '#ff5c72'
                        },
                        {
                            label: 'Trend',
                            data: trend,
                            borderColor: '#f5a623',
                            borderWidth: 2,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            fill: false,
                            tension: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'top' } },
                    scales: { y: { beginAtZero: true } }
                }
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [cycle, cycleTxs, today]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const expenseTxs = cycleTxs.filter(t => t.type === 'expense');
            let labels: string[], data: number[], title: string;
            if (chartView.mode === 'source') {
                const bySource = expenseTxs.reduce<Record<string, number>>((acc, t) => {
                    const src = t.payment_source || 'Unknown';
                    acc[src] = (acc[src] || 0) + Number(t.amount);
                    return acc;
                }, {});
                labels = Object.keys(bySource);
                data = Object.values(bySource);
                title = 'Expenses by Source';
            } else {
                const source = chartView.source ?? '';
                const byCategory = expenseTxs
                    .filter(t => (t.payment_source || 'Unknown') === source)
                    .reduce<Record<string, number>>((acc, t) => {
                        acc[t.category || 'Uncategorized'] =
                            (acc[t.category || 'Uncategorized'] || 0) + Number(t.amount);
                        return acc;
                    }, {});
                labels = Object.keys(byCategory);
                data = Object.values(byCategory);
                title = `Expenses via ${source}`;
            }

            const Chart = await loadChart();
            if (cancelled || !donutCanvasRef.current) return;
            donutChartRef.current?.destroy();
            donutChartRef.current = new Chart(donutCanvasRef.current.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [
                        {
                            data,
                            backgroundColor: [
                                '#0B1E3D',
                                '#00d4aa',
                                '#f5a623',
                                '#ff5c72',
                                '#3b82f6',
                                '#c44dff'
                            ],
                            borderWidth: 2,
                            borderColor: 'transparent'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (_evt: unknown, elements: Array<{ index: number }>) => {
                        const clickedLabel = elements[0] ? labels[elements[0].index] : undefined;
                        if (clickedLabel && chartView.mode === 'source') {
                            setChartView({ mode: 'category', source: clickedLabel });
                        }
                    }
                }
            });
            const titleEl = document.getElementById('donut-chart-title-react');
            if (titleEl) titleEl.textContent = title;
        })();
        return () => {
            cancelled = true;
        };
    }, [cycleTxs, chartView]);

    useEffect(() => {
        if (!forecast) {
            forecastChartRef.current?.destroy();
            forecastChartRef.current = null;
            return;
        }
        let cancelled = false;
        (async () => {
            const labels = [...forecast.recent.map(c => niceDate(c.start)), 'Next (predicted)'];
            const data = [...forecast.recent.map(c => c.total), forecast.predicted];
            const Chart = await loadChart();
            if (cancelled || !forecastCanvasRef.current) return;
            forecastChartRef.current?.destroy();
            forecastChartRef.current = new Chart(forecastCanvasRef.current.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Cycle total expenses',
                            data,
                            backgroundColor: data.map((_, i) =>
                                i === data.length - 1 ? 'rgba(196,77,255,0.55)' : 'rgba(255,92,114,0.55)'
                            ),
                            borderColor: data.map((_, i) => (i === data.length - 1 ? '#c44dff' : '#ff5c72')),
                            borderWidth: 1.5
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true } }
                }
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [forecast]);

    const analysis = useMemo(
        () =>
            PFHealth.analyze({
                transactions,
                today,
                cycleIndex: selectedIdx,
                budgetLimits: window.app?.budgetLimits ?? {}
            }) as unknown as Analysis,
        [transactions, today, selectedIdx, settingsVersion]
    );

    if (!cycle) return null;

    const runRateColor =
        proj && proj.projectedBalance < 0
            ? 'var(--expense)'
            : proj && proj.projectedBalance < income * 0.1
              ? 'var(--warning)'
              : 'var(--income)';
    const runRateTextColor =
        proj && proj.projectedBalance < 0
            ? 'var(--expense-text)'
            : proj && proj.projectedBalance < income * 0.1
              ? 'var(--warning)'
              : 'var(--income-text)';

    return (
        <>
            <div className="dashboard-header">
                <h2>Your finances</h2>
                <div className="cycle-select-wrap">
                    <select
                        aria-label="Salary cycle"
                        value={selectedIdx}
                        onChange={e => setSelectedIdx(Number(e.target.value))}
                    >
                        {cycles.map((c, i) => (
                            <option value={i} key={c.start}>
                                {'fallback' in c && c.fallback
                                    ? 'Current Month'
                                    : c.isCurrent
                                      ? `Current: Since ${niceDate(c.start)}`
                                      : `${niceDate(c.start)} – ${niceDate(c.end)}`}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {budgetWarnings.length > 0 && (
                <div className="budget-warnings-block">
                    {budgetWarnings.map(w => (
                        <div
                            className={`budget-warning-item ${w.over ? 'over-budget' : 'near-budget'}`}
                            key={w.cat}
                        >
                            <div className="budget-warning-header">
                                <span>
                                    {w.icon} {w.cat}
                                </span>
                                <span className="budget-badge">
                                    {w.over ? '🚨 Over budget' : `⚠️ ${w.pct.toFixed(0)}%`}
                                </span>
                            </div>
                            <div className="budget-bar-track">
                                <div
                                    className="budget-bar-fill"
                                    style={{
                                        width: `${w.pct}%`,
                                        background: w.over ? 'var(--expense)' : 'var(--warning)'
                                    }}
                                />
                            </div>
                            <div className="budget-bar-labels">
                                <span>{money0(w.spent)} spent</span>
                                <span>₹{w.limit} limit</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {givingFloorWarning && (
                <div className="budget-warnings-block">
                    <div className="budget-warning-item near-budget">
                        <div className="budget-warning-header">
                            <span>
                                {givingFloorWarning.icon} {givingFloorWarning.cat}
                            </span>
                            <span className="budget-badge">
                                ⚠️ {givingFloorWarning.pct.toFixed(0)}% of {givingFloorWarning.floorPct}%
                                floor
                            </span>
                        </div>
                        <div className="budget-bar-track">
                            <div
                                className="budget-bar-fill"
                                style={{ width: `${givingFloorWarning.pct}%`, background: 'var(--warning)' }}
                            />
                        </div>
                        <div className="budget-bar-labels">
                            <span>{money0(givingFloorWarning.given)} given</span>
                            <span>{money0(givingFloorWarning.shortBy)} more to reach floor</span>
                        </div>
                    </div>
                </div>
            )}

            <HealthHero
                health={analysis.health}
                priorCount={analysis.priorCount}
                isCurrent={analysis.cycle.isCurrent}
            />
            <ActionList actions={analysis.actions} />

            <div className="summary">
                <div className="summary-row">
                    <span className="k">Income this cycle</span>
                    <span className="v income">{money(income)}</span>
                </div>
                <div className="summary-row">
                    <span className="k">Expenses this cycle</span>
                    <span className="v expense">{money(expenses)}</span>
                </div>
                <div className="summary-row">
                    <span className="k">No-Spend Streak</span>
                    <span className="v-stack">
                        <span className="v">
                            {streak.currentStreak} {streak.currentStreak === 1 ? 'Day' : 'Days'}
                        </span>
                        <small className="v-sub">
                            Best: {streak.bestStreak} {streak.bestStreak === 1 ? 'day' : 'days'}
                        </small>
                    </span>
                </div>
                <div className="summary-row summary-row--closing">
                    <span className="k">Remaining</span>
                    <span className="v v--closing">{money(balance)}</span>
                </div>
            </div>

            <div className="predictive" id="risk-card" style={{ borderLeft: `4px solid ${runRateColor}` }}>
                <span className="predictive-dot"></span>
                <div className="predictive-body">
                    {proj && income > 0 ? (
                        <>
                            <p className="predictive-lead" style={{ color: runRateTextColor }}>
                                {proj.projectedBalance < 0
                                    ? `Short by ${money0(Math.abs(proj.projectedBalance))}`
                                    : proj.projectedBalance < income * 0.1
                                      ? `${money0(proj.projectedBalance)} leftover (thin margin)`
                                      : `+${money0(proj.projectedBalance)} projected surplus`}
                            </p>
                            <p className="run-rate-note">
                                {proj.projectedBalance < 0
                                    ? `Cut spending to ${money0(Math.max(0, Math.abs(proj.projectedBalance) / (proj.daysRemaining || 1)))}/day less than now to break even.`
                                    : proj.projectedBalance < income * 0.1
                                      ? `Stay under ${money0(Math.max(0, (income * 0.9 - proj.expensesSoFar) / (proj.daysRemaining || 1)))}/day for the rest of the cycle to keep a safety margin.`
                                      : leak
                                        ? 'On track overall.'
                                        : 'On track — no unusual spending detected this cycle.'}
                                {leak && (
                                    <>
                                        {' '}
                                        Watch <b>{leak.cat}</b> — already +{money0(leak.diff)} over your usual
                                        pace.
                                    </>
                                )}
                            </p>
                        </>
                    ) : (
                        <p className="predictive-lead">Log some income to see your run rate.</p>
                    )}
                </div>
            </div>

            {analysis.pace && <PaceChart pace={analysis.pace} />}
            <CategoryTable rows={analysis.rows} hasHistory={analysis.priorCount > 0} />
            {analysis.trend && analysis.trend.length >= 2 && <TrendChart trend={analysis.trend} />}

            {forecast && (
                <div className="chart-container">
                    <h3>Spending forecast</h3>
                    <p className="page-subtitle">
                        Linear trend across your last {forecast.recent.length} full cycles projects roughly{' '}
                        <b>{money0(forecast.predicted)}</b> in total expenses next cycle
                        {forecast.slope > 0 ? ', trending up' : forecast.slope < 0 ? ', trending down' : ''} —
                        an estimate, not a guarantee.
                    </p>
                    <canvas ref={forecastCanvasRef}></canvas>
                </div>
            )}

            <div className="chart-container">
                <h3>Daily spending</h3>
                <canvas ref={lineCanvasRef}></canvas>
            </div>

            <div className="chart-container">
                <h3 id="donut-chart-title-react">Expenses by source</h3>
                <canvas ref={donutCanvasRef}></canvas>
                {chartView.mode === 'category' && (
                    <button
                        className="btn btn-secondary"
                        style={{ marginTop: 15 }}
                        onClick={() => setChartView({ mode: 'source' })}
                    >
                        ⬅️ Back to Sources
                    </button>
                )}
            </div>

            <div className="transactions-section">
                <div className="section-header">
                    <h3>Transactions</h3>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div className="filter-controls">
                            <select
                                aria-label="Filter by type"
                                value={filterType}
                                onChange={e => setFilterType(e.target.value)}
                            >
                                <option value="">All Types</option>
                                <option value="income">Income</option>
                                <option value="expense">Expenses</option>
                            </select>
                            <select
                                aria-label="Filter by category"
                                value={filterCategory}
                                onChange={e => setFilterCategory(e.target.value)}
                            >
                                <option value="">All Categories</option>
                                {categories
                                    .slice()
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map(c => (
                                        <option value={c.name} key={c.name}>
                                            {c.icon} {c.name}
                                        </option>
                                    ))}
                            </select>
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={exportCSV}>
                            ⬇️ Export CSV
                        </button>
                    </div>
                </div>
                <div id="transactions-list" className="transactions-list" aria-live="polite">
                    {filtered.length === 0 ? (
                        <div className="loading">No transactions found</div>
                    ) : (
                        filtered.map(t => (
                            <TransactionRow
                                key={t.id}
                                tx={t}
                                icon={categories.find(c => c.name === t.category)?.icon ?? '📁'}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                            />
                        ))
                    )}
                </div>
            </div>
        </>
    );
}

function TransactionRow({
    tx,
    icon,
    onEdit,
    onDelete
}: {
    tx: Transaction;
    icon: string;
    onEdit: (id: Transaction['id']) => void;
    onDelete: (id: Transaction['id']) => void;
}) {
    const [dx, setDx] = useState(0);
    const [swiped, setSwiped] = useState(false);
    const startX = useRef(0);
    const dragging = useRef(false);

    function onTouchStart(e: React.TouchEvent) {
        const touch = e.touches[0];
        if (!touch) return;
        startX.current = touch.clientX;
        dragging.current = true;
    }
    function onTouchMove(e: React.TouchEvent) {
        if (!dragging.current) return;
        const touch = e.touches[0];
        if (!touch) return;
        const delta = touch.clientX - startX.current;
        if (delta < 0) setDx(Math.max(delta, -80));
    }
    function onTouchEnd() {
        if (!dragging.current) return;
        dragging.current = false;
        if (dx < -60) {
            setDx(-80);
            setSwiped(true);
        } else {
            setDx(0);
            setSwiped(false);
        }
    }

    return (
        <div className="transaction-item">
            <div className={`transaction-swipe-wrapper ${swiped ? 'swiped' : ''}`}>
                <div
                    className="transaction-content"
                    style={{
                        transform: `translateX(${dx}px)`,
                        transition: dragging.current ? 'none' : 'transform 0.2s ease'
                    }}
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                >
                    <div className="transaction-details">
                        <strong>
                            {icon} {tx.category}
                            {tx.is_recurring && <span className="recurring-badge">🔁 recurring</span>}
                        </strong>
                        <small>
                            {tx.transaction_date} · {tx.payment_to || 'N/A'} · {tx.payment_source || ''}
                        </small>
                    </div>
                    <div className="transaction-right">
                        <div className={tx.type === 'income' ? 'income' : 'expense'}>
                            {tx.type === 'income' ? '+' : '−'}₹{Number(tx.amount).toFixed(2)}
                        </div>
                        <div className="transaction-actions">
                            <button
                                className="tx-action-btn edit-btn"
                                title="Edit"
                                aria-label="Edit transaction"
                                onClick={() => onEdit(tx.id)}
                            >
                                ✏️
                            </button>
                            <button
                                className="tx-action-btn delete-btn"
                                title="Delete"
                                aria-label="Delete transaction"
                                onClick={() => onDelete(tx.id)}
                            >
                                🗑️
                            </button>
                        </div>
                    </div>
                </div>
                <div className="swipe-delete-bg" onClick={() => onDelete(tx.id)}>
                    🗑️ Delete
                </div>
            </div>
        </div>
    );
}
