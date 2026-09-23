// Presentational panels for the Dashboard's financial-health view. All the
// numbers come from src/engine/health.js (pure, unit-tested); this file only
// renders them and draws the two Chart.js charts.
import { useEffect, useRef } from 'react';
import { loadChart } from '../../../charts.js';

export interface Component {
    key: string;
    label: string;
    score: number;
    weight: number;
    headline: string;
    detail: string;
}
export interface Health {
    value: number;
    label: string;
    tone: 'good' | 'warn' | 'bad';
    components: Component[];
    confidence: 'good' | 'fair' | 'low';
    basedOn: number;
}
export interface Action {
    id: string;
    severity: 'high' | 'medium' | 'info' | 'good';
    title: string;
    detail: string;
    impact: number | null;
}
export interface Row {
    cat: string;
    amount: number;
    usual: number | null;
    delta: number | null;
    deltaPct: number | null;
    share: number;
    limit: number | null;
    limitPct: number | null;
}
export interface Pace {
    labels: string[];
    typical: number[];
    actual: number[];
    dayN: number;
    length: number;
    typicalToDate: number;
    actualToDate: number;
    aheadBy: number;
    projectedEnd: number | null;
    typicalEnd: number;
}
export interface TrendPoint {
    start: string;
    income: number;
    expenses: number;
    current: boolean;
}

export interface Analysis {
    status: 'ok' | 'empty';
    cycle: { start: string; end: string; isCurrent: boolean; dayN: number; days: number };
    priorCount: number;
    health: Health | null;
    rows: Row[];
    pace: Pace | null;
    actions: Action[];
    trend: TrendPoint[];
}

const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;

// ---------------- score ring + breakdown ----------------

function Ring({ value, tone }: { value: number; tone: Health['tone'] }) {
    const r = 46;
    const c = 2 * Math.PI * r;
    return (
        <svg
            className={`health-ring health-ring--${tone}`}
            viewBox="0 0 112 112"
            role="img"
            aria-label={`Health score ${value} out of 100`}
        >
            <circle className="health-ring-track" cx="56" cy="56" r={r} />
            <circle
                className="health-ring-fill"
                cx="56"
                cy="56"
                r={r}
                strokeDasharray={`${(value / 100) * c} ${c}`}
                transform="rotate(-90 56 56)"
            />
            <text x="56" y="60" textAnchor="middle" className="health-ring-value">
                {value}
            </text>
            <text x="56" y="76" textAnchor="middle" className="health-ring-of">
                / 100
            </text>
        </svg>
    );
}

export function HealthHero({
    health,
    priorCount,
    isCurrent
}: {
    health: Health | null;
    priorCount: number;
    isCurrent: boolean;
}) {
    if (!health) {
        return (
            <section className="dash-card" aria-labelledby="health-title">
                <h3 id="health-title" className="dash-title">
                    Financial health
                </h3>
                <p className="dash-sub">
                    Add your salary and a few expenses and this fills in with a score, where your money goes,
                    and what to change.
                </p>
            </section>
        );
    }
    const confidenceNote =
        health.confidence === 'good'
            ? `Based on this cycle and ${priorCount} before it.`
            : priorCount === 0
              ? 'Early estimate — one cycle of data so far.'
              : `Based on this cycle and ${priorCount} before it. More cycles sharpen it.`;
    return (
        <section className="dash-card" aria-labelledby="health-title">
            <div className="health-top">
                <Ring value={health.value} tone={health.tone} />
                <div className="health-summary">
                    <h3 id="health-title" className="dash-title">
                        Financial health
                    </h3>
                    <p className={`health-verdict health-verdict--${health.tone}`}>{health.label}</p>
                    <p className="dash-sub">
                        {isCurrent
                            ? 'Projected to the end of this cycle. '
                            : 'Review of this finished cycle. '}
                        {confidenceNote}
                    </p>
                </div>
            </div>
            <ul className="health-list">
                {health.components.map(c => (
                    <li key={c.key} className="health-item">
                        <div className="health-item-head">
                            <span className="health-item-label">{c.label}</span>
                            <span className="health-item-figure">{c.headline}</span>
                        </div>
                        <div className="health-bar" aria-hidden="true">
                            <div
                                className={`health-bar-fill health-bar-fill--${c.score >= 65 ? 'good' : c.score >= 45 ? 'warn' : 'bad'}`}
                                style={{ width: `${Math.max(3, c.score)}%` }}
                            />
                        </div>
                        <p className="health-item-detail">{c.detail}</p>
                    </li>
                ))}
            </ul>
            <p className="dash-fineprint">
                An estimate from your own tracked entries, not financial advice. Parts without enough data are
                left out rather than guessed.
            </p>
        </section>
    );
}

// ---------------- recommendations ----------------

const SEVERITY_LABEL: Record<Action['severity'], string> = {
    high: 'Act now',
    medium: 'Worth fixing',
    info: 'Good to know',
    good: 'Going well'
};

export function ActionList({ actions }: { actions: Action[] }) {
    if (!actions.length) return null;
    return (
        <section className="dash-card" aria-labelledby="actions-title">
            <h3 id="actions-title" className="dash-title">
                What to do next
            </h3>
            <p className="dash-sub">Ranked by how much each is worth to you this cycle.</p>
            <ol className="action-list">
                {actions.map(a => (
                    <li key={a.id} className={`action action--${a.severity}`}>
                        <div className="action-head">
                            <span className="action-tag">{SEVERITY_LABEL[a.severity]}</span>
                            {a.impact !== null && a.impact > 0 && (
                                <span className="action-impact">{inr(a.impact)}</span>
                            )}
                        </div>
                        <p className="action-title">{a.title}</p>
                        <p className="action-detail">{a.detail}</p>
                    </li>
                ))}
            </ol>
        </section>
    );
}

// ---------------- where the money goes ----------------

export function CategoryTable({ rows, hasHistory }: { rows: Row[]; hasHistory: boolean }) {
    const shown = rows.filter(r => r.amount > 0).slice(0, 8);
    if (!shown.length) return null;
    return (
        <section className="dash-card" aria-labelledby="cats-title">
            <h3 id="cats-title" className="dash-title">
                Where your money goes
            </h3>
            <p className="dash-sub">
                {hasHistory
                    ? 'Compared with your usual spend at this point in a cycle.'
                    : 'Comparisons appear after you have a previous cycle.'}
            </p>
            <ul className="cat-list">
                {shown.map(r => {
                    const up =
                        r.delta !== null && r.delta >= 500 && (r.deltaPct === null || r.deltaPct >= 15);
                    const down =
                        r.delta !== null && r.delta <= -500 && r.deltaPct !== null && r.deltaPct <= -15;
                    return (
                        <li key={r.cat} className="cat-row">
                            <div className="cat-line">
                                <span className="cat-name">{r.cat}</span>
                                <span className="cat-amount">{inr(r.amount)}</span>
                            </div>
                            <div className="cat-bar" aria-hidden="true">
                                <div
                                    className="cat-bar-fill"
                                    style={{ width: `${Math.max(2, r.share * 100)}%` }}
                                />
                            </div>
                            <div className="cat-meta">
                                <span>{Math.round(r.share * 100)}% of spending</span>
                                {hasHistory && r.usual !== null && (
                                    <span
                                        className={
                                            up
                                                ? 'cat-flag cat-flag--up'
                                                : down
                                                  ? 'cat-flag cat-flag--down'
                                                  : ''
                                        }
                                    >
                                        {up ? '▲' : down ? '▼' : '≈'} usual {inr(r.usual)}
                                    </span>
                                )}
                                {r.limit !== null && (
                                    <span
                                        className={
                                            r.limitPct !== null && r.limitPct > 100
                                                ? 'cat-flag cat-flag--up'
                                                : ''
                                        }
                                    >
                                        limit {inr(r.limit)}
                                    </span>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

// ---------------- charts ----------------

const css = (name: string, fallback: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function PaceChart({ pace }: { pace: Pace }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const chart = useRef<{ destroy: () => void } | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const Chart = await loadChart();
            if (cancelled || !ref.current) return;
            chart.current?.destroy();
            const grid = css('--border', 'rgba(0,0,0,0.08)');
            const muted = css('--text2', '#666');
            const labels = pace.labels.map((_, i) => `Day ${i + 1}`);
            const projected =
                pace.projectedEnd === null
                    ? []
                    : labels.map((_, i) =>
                          i === pace.dayN - 1
                              ? (pace.actual[i] ?? 0)
                              : i === pace.length - 1
                                ? pace.projectedEnd
                                : null
                      );
            chart.current = new Chart(ref.current.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Your usual',
                            data: pace.typical,
                            borderColor: muted,
                            backgroundColor: 'rgba(120,120,160,0.10)',
                            fill: true,
                            borderWidth: 1.5,
                            pointRadius: 0,
                            tension: 0.25
                        },
                        {
                            label: 'This cycle',
                            data: pace.actual,
                            borderColor: '#3b82f6',
                            borderWidth: 2.5,
                            pointRadius: 0,
                            tension: 0.25
                        },
                        {
                            label: 'Projected',
                            data: projected,
                            borderColor: '#3b82f6',
                            borderDash: [5, 5],
                            borderWidth: 2,
                            pointRadius: 3,
                            spanGaps: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                boxWidth: 8,
                                boxHeight: 8,
                                usePointStyle: true,
                                pointStyle: 'circle',
                                color: muted
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (ctx: {
                                    dataset: { label?: string };
                                    parsed: { y: number | null };
                                }) =>
                                    ctx.parsed.y === null ? '' : `${ctx.dataset.label}: ${inr(ctx.parsed.y)}`
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: muted, maxTicksLimit: 6 } },
                        y: {
                            beginAtZero: true,
                            grid: { color: grid },
                            ticks: {
                                color: muted,
                                callback: (v: string | number) =>
                                    `₹${Number(v) >= 1000 ? `${Number(v) / 1000}k` : v}`
                            }
                        }
                    }
                }
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [pace]);

    useEffect(() => () => chart.current?.destroy(), []);

    const ahead = pace.aheadBy >= 0;
    return (
        <section className="dash-card" aria-labelledby="pace-title">
            <h3 id="pace-title" className="dash-title">
                Your pace this cycle
            </h3>
            <p className="dash-sub">
                Day {pace.dayN}: you have spent <b>{inr(pace.actualToDate)}</b>; a typical cycle is at{' '}
                <b>{inr(pace.typicalToDate)}</b> by now — you are{' '}
                <b className={ahead ? 'tone-good' : 'tone-bad'}>
                    {inr(pace.aheadBy)} {ahead ? 'under' : 'over'}
                </b>{' '}
                your usual.
            </p>
            <div className="dash-canvas">
                <canvas
                    ref={ref}
                    role="img"
                    aria-label="Cumulative spending this cycle compared with your usual pace"
                ></canvas>
            </div>
        </section>
    );
}

export function TrendChart({ trend }: { trend: TrendPoint[] }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const chart = useRef<{ destroy: () => void } | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const Chart = await loadChart();
            if (cancelled || !ref.current) return;
            chart.current?.destroy();
            const grid = css('--border', 'rgba(0,0,0,0.08)');
            const muted = css('--text2', '#666');
            chart.current = new Chart(ref.current.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: trend.map(t =>
                        new Date(`${t.start}T12:00:00`).toLocaleDateString('en-IN', {
                            month: 'short',
                            day: 'numeric'
                        })
                    ),
                    datasets: [
                        {
                            label: 'Income',
                            data: trend.map(t => t.income),
                            backgroundColor: 'rgba(0,212,170,0.55)',
                            borderRadius: 4
                        },
                        {
                            label: 'Spending',
                            data: trend.map(t => t.expenses),
                            backgroundColor: 'rgba(255,92,114,0.6)',
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                boxWidth: 8,
                                boxHeight: 8,
                                usePointStyle: true,
                                pointStyle: 'circle',
                                color: muted
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
                                    `${ctx.dataset.label}: ${inr(ctx.parsed.y ?? 0)}`
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: muted } },
                        y: {
                            beginAtZero: true,
                            grid: { color: grid },
                            ticks: {
                                color: muted,
                                callback: (v: string | number) =>
                                    `₹${Number(v) >= 1000 ? `${Number(v) / 1000}k` : v}`
                            }
                        }
                    }
                }
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [trend]);

    useEffect(() => () => chart.current?.destroy(), []);

    return (
        <section className="dash-card" aria-labelledby="trend-title">
            <h3 id="trend-title" className="dash-title">
                Income vs spending
            </h3>
            <p className="dash-sub">
                Each cycle, oldest to newest. The gap between the bars is what you kept.
            </p>
            <div className="dash-canvas">
                <canvas ref={ref} role="img" aria-label="Income and spending for each recent cycle"></canvas>
            </div>
        </section>
    );
}
