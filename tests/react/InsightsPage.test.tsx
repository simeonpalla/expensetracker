// @vitest-environment jsdom
//
// Component test for the Insights page React port. The engine modules
// (dates/cycles/projection) are mocked with canned values — their actual
// math is already covered by tests/engine/*.test.js (47 tests); this file
// tests InsightsPage's rendering logic given known computed values, not
// the engine itself.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsightsPage from '../../src/react/pages/InsightsPage';

vi.mock('../../src/engine/dates.js', () => ({
    default: {
        todayStr: vi.fn(() => '2026-09-15'),
        parseLocal: vi.fn((s: string) => new Date(`${s}T12:00:00Z`))
    }
}));
vi.mock('../../src/engine/cycles.js', () => ({
    default: { transactionsInCycle: vi.fn() }
}));
vi.mock('../../src/engine/projection.js', () => ({
    default: {
        historicalMonths: vi.fn(() => 3),
        spendByCategory: vi.fn(() => ({})),
        computeAnomalies: vi.fn(() => []),
        projectCycle: vi.fn(() => ({ dailyBurnRate: 500, daysRemaining: 10, projectedBalance: 5000 })),
        weekendWeekdayStats: vi.fn(() => ({ weekendAvg: 0, weekdayAvg: 0 })),
        cycleExpenseTotals: vi.fn(() => [])
    }
}));

import PFCycles from '../../src/engine/cycles.js';
import PFProjection from '../../src/engine/projection.js';

const baseApp = {
    transactions: [],
    currentCycleStart: '2026-09-01',
    currentCycleEnd: '2026-09-30',
    givingFloorCategory: ''
};

beforeEach(() => {
    window.app = undefined;
    vi.mocked(PFCycles.transactionsInCycle).mockReset();
    vi.mocked(PFProjection.computeAnomalies).mockReset().mockReturnValue([]);
});

describe('InsightsPage', () => {
    it('shows a nudge to log more data when the current cycle has under 3 transactions', async () => {
        const user = userEvent.setup();
        vi.mocked(PFCycles.transactionsInCycle).mockReturnValue([
            { id: 1, type: 'expense', amount: 100, category: 'Food', transaction_date: '2026-09-02' }
        ]);
        window.app = baseApp as never;

        render(<InsightsPage />);
        await user.click(screen.getByRole('button', { name: /Analyze Historical Data/ }));

        expect(screen.getByText(/Crunching your numbers/)).toBeInTheDocument();
        await waitFor(() =>
            expect(
                screen.getByText(/Log a few more transactions in this cycle before I can run a full audit/)
            ).toBeInTheDocument()
        );
    });

    it('renders a green run-rate badge and no-anomaly audit for a healthy cycle', async () => {
        const user = userEvent.setup();
        vi.mocked(PFCycles.transactionsInCycle).mockReturnValue([
            { id: 1, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-09-01' },
            { id: 2, type: 'expense', amount: 10000, category: 'Food', transaction_date: '2026-09-05' },
            { id: 3, type: 'expense', amount: 5000, category: 'Transport', transaction_date: '2026-09-10' }
        ]);
        window.app = {
            ...baseApp,
            transactions: [{ transaction_date: '2026-08-01', type: 'expense', amount: 100, category: 'Food' }]
        } as never;

        const { container } = render(<InsightsPage />);
        await user.click(screen.getByRole('button', { name: /Analyze Historical Data/ }));

        await waitFor(() => expect(screen.getByText(/Surplus Projected/)).toBeInTheDocument());
        expect(container.querySelector('.insight-badge--green')?.textContent).toContain(
            'No significant overspending detected against your 3.0-month baseline.'
        );
        // Savings rate: (50000 - 15000) / 50000 = 70%
        expect(screen.getByText('70%')).toBeInTheDocument();
    });

    it('renders a red deficit run-rate badge and the anomaly audit when overspending', async () => {
        const user = userEvent.setup();
        vi.mocked(PFCycles.transactionsInCycle).mockReturnValue([
            { id: 1, type: 'income', amount: 10000, category: 'Salary', transaction_date: '2026-09-01' },
            { id: 2, type: 'expense', amount: 8000, category: 'Food', transaction_date: '2026-09-05' },
            { id: 3, type: 'expense', amount: 5000, category: 'Shopping', transaction_date: '2026-09-10' }
        ]);
        vi.mocked(PFProjection.projectCycle).mockReturnValue({
            dailyBurnRate: 1300,
            daysRemaining: 10,
            projectedBalance: -3000
        });
        vi.mocked(PFProjection.computeAnomalies).mockReturnValue([
            { cat: 'Food', currentAmt: 8000, histAvg: 4000, diff: 4000, pct: 100 }
        ]);
        window.app = { ...baseApp, transactions: [{ transaction_date: '2026-08-01' }] } as never;

        render(<InsightsPage />);
        await user.click(screen.getByRole('button', { name: /Analyze Historical Data/ }));

        await waitFor(() => expect(screen.getByText(/Deficit Projected/)).toBeInTheDocument());
        // "Food" legitimately appears twice: once in the audit's anomaly
        // row, once as the "Target the Leak" top-spender label.
        expect(screen.getAllByText('Food')).toHaveLength(2);
        expect(screen.getByText('+100%')).toBeInTheDocument();
        expect(screen.getByText(/Re-peg Food/)).toBeInTheDocument();
    });

    it('renders the month-over-month chart most-recent-cycle first, with the current cycle marked', async () => {
        const user = userEvent.setup();
        vi.mocked(PFCycles.transactionsInCycle).mockReturnValue([
            { id: 1, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-09-01' },
            { id: 2, type: 'expense', amount: 10000, category: 'Food', transaction_date: '2026-09-05' },
            { id: 3, type: 'expense', amount: 5000, category: 'Transport', transaction_date: '2026-09-10' }
        ]);
        // Oldest-first, as PFProjection.cycleExpenseTotals actually returns
        // it — the component must reverse this for display without
        // touching the recent/prev trend math, which still needs the last
        // element to be the current cycle.
        vi.mocked(PFProjection.cycleExpenseTotals).mockReturnValue([
            { start: '2026-07-01', end: '2026-07-31', total: 12000 },
            { start: '2026-08-01', end: '2026-08-31', total: 18000 },
            { start: '2026-09-01', end: '2026-09-30', total: 15000 }
        ]);
        window.app = baseApp as never;

        const { container } = render(<InsightsPage />);
        await user.click(screen.getByRole('button', { name: /Analyze Historical Data/ }));
        await waitFor(() => expect(container.querySelector('.insight-bar-chart')).toBeInTheDocument());

        const labels = [...container.querySelectorAll('.insight-bar-label')];
        expect(labels).toHaveLength(3);
        // The current cycle (2026-09-01, last in the oldest-first mock
        // data) should render FIRST and carry the current-cycle dot.
        expect(container.querySelector('.insight-bar-col:first-child .insight-bar-current-dot')).toBeTruthy();
        expect(container.querySelector('.insight-bar-col:last-child .insight-bar-current-dot')).toBeFalsy();
    });
});
