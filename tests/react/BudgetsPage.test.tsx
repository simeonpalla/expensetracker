// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BudgetsPage from '../../src/react/pages/BudgetsPage';

vi.mock('../../src/api.js', () => ({
    API: { getCategories: vi.fn(), saveSettings: vi.fn() }
}));
vi.mock('../../src/ui.js', () => ({
    showNotification: vi.fn()
}));

import { API } from '../../src/api.js';
import { showNotification } from '../../src/ui.js';

const mockCategories = [
    { id: 1, name: 'Salary', type: 'income', icon: '💰' },
    { id: 2, name: 'Food', type: 'expense', icon: '🍔' },
    { id: 3, name: 'Rent', type: 'expense', icon: '🏠' }
];

beforeEach(() => {
    vi.mocked(API.getCategories).mockReset().mockResolvedValue(mockCategories);
    vi.mocked(API.saveSettings).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(showNotification).mockReset();
    window.app = undefined;
});

describe('BudgetsPage', () => {
    it('renders a limit input per expense category only (not income)', async () => {
        render(<BudgetsPage />);
        await waitFor(() => expect(screen.getByLabelText('🍔 Food')).toBeInTheDocument());
        expect(screen.getByLabelText('🏠 Rent')).toBeInTheDocument();
        expect(screen.queryByLabelText(/Salary/)).not.toBeInTheDocument();
    });

    it('pre-fills limits already saved on the account', async () => {
        window.app = { budgetLimits: { Food: 5000 } };
        render(<BudgetsPage />);
        await waitFor(() => expect(screen.getByLabelText('🍔 Food')).toHaveValue(5000));
    });

    it('saves budget limits to the server, updates the app, and resyncs the dashboard', async () => {
        const user = userEvent.setup();
        const updateDashboardStats = vi.fn();
        window.app = { currentCycleStart: '2026-09-01', currentCycleEnd: '2026-09-30', updateDashboardStats };

        render(<BudgetsPage />);
        await waitFor(() => expect(screen.getByLabelText('🍔 Food')).toBeInTheDocument());

        await user.type(screen.getByLabelText('🍔 Food'), '4000');
        await user.click(screen.getByRole('button', { name: '💾 Save Budget Limits' }));

        await waitFor(() => expect(API.saveSettings).toHaveBeenCalledWith({ budget_limits: { Food: 4000 } }));
        await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Budget limits saved!'));
        expect(window.app?.budgetLimits).toEqual({ Food: 4000 });
        expect(updateDashboardStats).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    });

    it('auto-guesses an Offering-like category as the giving floor when nothing is saved', async () => {
        const categoriesWithOffering = [
            ...mockCategories,
            { id: 4, name: 'Offering', type: 'expense', icon: '🙏' }
        ];
        vi.mocked(API.getCategories).mockResolvedValue(categoriesWithOffering);
        window.app = {};

        render(<BudgetsPage />);
        await waitFor(() => expect(screen.getByLabelText('Category')).toHaveValue('Offering'));
        expect(window.app?.givingFloorCategory).toBe('Offering');
    });

    it('saves the giving floor and clamps an empty percentage to 5', async () => {
        // Real browsers block submitting a negative value past the input's
        // min="0" constraint (same as the original vanilla form), so the
        // pct >= 0 ? pct : 5 fallback in the handler is really for this
        // case: an emptied field parses to NaN, not a manually-typed
        // negative number.
        const user = userEvent.setup();
        window.app = {};

        render(<BudgetsPage />);
        await waitFor(() => expect(screen.getByLabelText('Minimum % of income')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Minimum % of income'), { target: { value: '' } });
        await user.selectOptions(screen.getByLabelText('Category'), 'Rent');
        await user.click(screen.getByRole('button', { name: '💾 Save Floor' }));

        await waitFor(() =>
            expect(API.saveSettings).toHaveBeenCalledWith({
                giving_floor_pct: 5,
                giving_floor_category: 'Rent'
            })
        );
        await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Giving floor saved!'));
    });
});

describe('BudgetsPage save failures', () => {
    it('keeps the old limits and shows an error when the server rejects the save', async () => {
        const user = userEvent.setup();
        vi.mocked(API.saveSettings).mockRejectedValue(new Error('boom'));
        window.app = { budgetLimits: { Food: 1000 } };
        render(<BudgetsPage />);
        await waitFor(() => expect(screen.getByLabelText('🍔 Food')).toBeInTheDocument());
        await user.type(screen.getByLabelText('🍔 Food'), '9');
        await user.click(screen.getByRole('button', { name: '💾 Save Budget Limits' }));
        await waitFor(() =>
            expect(showNotification).toHaveBeenCalledWith('Could not save budget limits: boom', 'error')
        );
        expect(window.app?.budgetLimits).toEqual({ Food: 1000 });
    });
});
