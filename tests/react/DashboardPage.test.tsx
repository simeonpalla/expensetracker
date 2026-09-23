// @vitest-environment jsdom
//
// Component test for the Dashboard page React port. Chart.js is mocked
// (jsdom has no real canvas 2d context, and its actual rendering math is
// out of scope here) — this file covers DashboardPage's own logic: cycle
// selection, stats, budget/giving-floor warnings, the OLS forecast gate,
// and row actions delegating to window.app.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from '../../src/react/pages/DashboardPage';

class MockChart {
    destroy() {}
}

vi.mock('../../src/charts.js', () => ({
    loadChart: vi.fn(() => Promise.resolve(MockChart))
}));

// jsdom has no real canvas backend; DashboardPage calls getContext('2d')
// before handing it to the (mocked) Chart constructor above, which
// doesn't care about the value but jsdom logs a noisy "not implemented"
// error without this stub.
HTMLCanvasElement.prototype.getContext = vi.fn() as unknown as typeof HTMLCanvasElement.prototype.getContext;
vi.mock('../../src/ui.js', () => ({
    showNotification: vi.fn()
}));

import { showNotification } from '../../src/ui.js';

const categories = [
    { id: 1, name: 'Salary', type: 'income', icon: '💰' },
    { id: 2, name: 'Food', type: 'expense', icon: '🍔' },
    { id: 3, name: 'Offering', type: 'expense', icon: '🙏' }
];

function buildApp(overrides: Record<string, unknown> = {}) {
    return {
        transactions: [
            { id: 1, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-09-01' },
            { id: 2, type: 'expense', amount: 8000, category: 'Food', transaction_date: '2026-09-05' }
        ],
        categories,
        budgetLimits: {},
        givingFloorPct: 5,
        givingFloorCategory: '',
        openEditModalById: vi.fn(),
        deleteTransaction: vi.fn(),
        ...overrides
    };
}

beforeEach(() => {
    window.app = undefined;
    vi.mocked(showNotification).mockReset();
});

describe('DashboardPage', () => {
    it('renders income/expense/balance for the current cycle', async () => {
        window.app = buildApp() as never;
        render(<DashboardPage />);

        await waitFor(() => expect(screen.getByText('₹50,000.00')).toBeInTheDocument());
        expect(screen.getByText('₹8,000.00')).toBeInTheDocument();
        expect(screen.getByText('₹42,000.00')).toBeInTheDocument();
    });

    it('shows a budget warning once spend crosses 80% of the category limit', async () => {
        window.app = buildApp({ budgetLimits: { Food: 9000 } }) as never;
        render(<DashboardPage />);

        await waitFor(() => expect(document.querySelector('.budget-warning-item')).not.toBeNull());
        const warning = document.querySelector('.budget-warning-item');
        expect(warning?.textContent).toContain('89%');
        expect(warning?.textContent).toContain('Food');
    });

    it('shows a giving-floor warning when the pegged category is under its % of income', async () => {
        window.app = buildApp({ givingFloorCategory: 'Offering', givingFloorPct: 10 }) as never;
        render(<DashboardPage />);

        await waitFor(() => expect(screen.getByText(/more to reach floor/)).toBeInTheDocument());
        const warning = screen.getByText(/more to reach floor/).closest('.budget-warning-item');
        expect(warning?.textContent).toContain('Offering');
    });

    it('does not show the spending forecast with fewer than 4 completed cycles', async () => {
        window.app = buildApp() as never;
        render(<DashboardPage />);

        await waitFor(() => expect(screen.getByText('Daily spending')).toBeInTheDocument());
        expect(screen.queryByText('Spending forecast')).not.toBeInTheDocument();
    });

    it('shows the spending forecast once at least 4 salary cycles exist', async () => {
        window.app = buildApp({
            transactions: [
                { id: 1, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-06-01' },
                { id: 2, type: 'expense', amount: 10000, category: 'Food', transaction_date: '2026-06-05' },
                { id: 3, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-07-01' },
                { id: 4, type: 'expense', amount: 12000, category: 'Food', transaction_date: '2026-07-05' },
                { id: 5, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-08-01' },
                { id: 6, type: 'expense', amount: 14000, category: 'Food', transaction_date: '2026-08-05' },
                { id: 7, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-09-01' },
                { id: 8, type: 'expense', amount: 16000, category: 'Food', transaction_date: '2026-09-05' },
                { id: 9, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-09-23' }
            ]
        }) as never;
        render(<DashboardPage />);

        await waitFor(() => expect(screen.getByText('Spending forecast')).toBeInTheDocument());
        expect(screen.getByText(/full cycles projects roughly/)).toBeInTheDocument();
    });

    it('delegates edit/delete row actions to window.app', async () => {
        const user = userEvent.setup();
        const app = buildApp();
        window.app = app as never;
        render(<DashboardPage />);

        await waitFor(() => expect(document.querySelectorAll('.transaction-item').length).toBe(2));
        const rows = document.querySelectorAll('.transaction-item');
        const row = [...rows].find(el => el.textContent?.includes('Food')) ?? null;
        expect(row).not.toBeNull();
        await user.click(within(row as HTMLElement).getByRole('button', { name: 'Edit transaction' }));
        expect(app.openEditModalById).toHaveBeenCalledWith(2);

        await user.click(within(row as HTMLElement).getByRole('button', { name: 'Delete transaction' }));
        expect(app.deleteTransaction).toHaveBeenCalledWith(2);
    });

    it('switching the cycle selector writes currentCycleStart/currentCycleEnd back onto window.app', async () => {
        const user = userEvent.setup();
        window.app = buildApp({
            transactions: [
                { id: 1, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-08-01' },
                { id: 2, type: 'expense', amount: 5000, category: 'Food', transaction_date: '2026-08-05' },
                { id: 3, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-09-01' },
                { id: 4, type: 'expense', amount: 8000, category: 'Food', transaction_date: '2026-09-05' }
            ]
        }) as never;
        render(<DashboardPage />);

        await waitFor(() => expect(window.app?.currentCycleStart).toBe('2026-09-01'));

        await user.selectOptions(screen.getByLabelText('Salary cycle'), '1');
        await waitFor(() => expect(window.app?.currentCycleStart).toBe('2026-08-01'));
        expect(window.app?.currentCycleEnd).toBe('2026-08-31');
    });

    it('exporting CSV shows an error when the cycle has no transactions', async () => {
        const user = userEvent.setup();
        window.app = buildApp({ transactions: [] }) as never;
        render(<DashboardPage />);

        await waitFor(() => expect(screen.getByText('No transactions found')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: /Export CSV/ }));
        expect(showNotification).toHaveBeenCalledWith('No transactions to export.', 'error');
    });

    it('shows a health score, ranked actions and a where-your-money-goes list', async () => {
        window.app = buildApp({
            transactions: [
                { id: 1, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-06-01' },
                { id: 2, type: 'expense', amount: 12000, category: 'Food', transaction_date: '2026-06-05' },
                { id: 3, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-07-01' },
                { id: 4, type: 'expense', amount: 12000, category: 'Food', transaction_date: '2026-07-05' },
                { id: 5, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-08-01' },
                { id: 6, type: 'expense', amount: 12000, category: 'Food', transaction_date: '2026-08-05' },
                { id: 7, type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-09-01' },
                {
                    id: 8,
                    type: 'expense',
                    amount: 60000,
                    category: 'Shopping',
                    transaction_date: '2026-09-04'
                }
            ]
        }) as never;
        render(<DashboardPage />);

        await waitFor(() => expect(screen.getByText('Financial health')).toBeInTheDocument());
        expect(screen.getByRole('img', { name: /Health score \d+ out of 100/ })).toBeInTheDocument();
        expect(screen.getByText('What to do next')).toBeInTheDocument();
        expect(screen.getByText(/On track to overspend/)).toBeInTheDocument();
        expect(screen.getByText('Where your money goes')).toBeInTheDocument();
    });

    it('shows a gentle placeholder instead of a score when there is no data', async () => {
        window.app = buildApp({ transactions: [] }) as never;
        render(<DashboardPage />);
        await waitFor(() => expect(screen.getByText('Financial health')).toBeInTheDocument());
        expect(screen.getByText(/this fills in with a score/)).toBeInTheDocument();
        expect(screen.queryByText('What to do next')).not.toBeInTheDocument();
    });
});
