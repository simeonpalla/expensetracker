// @vitest-environment jsdom
//
// Component test for the Accounts page React port. Unlike the CJS Netlify
// function tests (which stub via require.cache — see the testing skill),
// src/**/*.js is real ESM, so vi.mock works natively here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountsPage from '../../src/react/pages/AccountsPage';

vi.mock('../../src/api.js', () => ({
    API: {
        getAccounts: vi.fn(),
        addAccount: vi.fn(),
        deleteAccount: vi.fn()
    }
}));
vi.mock('../../src/ui.js', () => ({
    showNotification: vi.fn()
}));

import { API } from '../../src/api.js';
import { showNotification } from '../../src/ui.js';

const mockAccounts = [
    { id: 1, name: 'UBI', type: 'upi' },
    { id: 2, name: 'ICICI Amazon', type: 'credit-card' }
];

beforeEach(() => {
    vi.mocked(API.getAccounts).mockReset().mockResolvedValue(mockAccounts);
    vi.mocked(API.addAccount).mockReset();
    vi.mocked(API.deleteAccount).mockReset();
    vi.mocked(showNotification).mockReset();
    window.app = undefined;
});

describe('AccountsPage', () => {
    it('shows a loading state, then the grouped accounts list', async () => {
        render(<AccountsPage />);
        expect(screen.getByText('Loading accounts...')).toBeInTheDocument();

        await waitFor(() => expect(screen.getByText('UBI')).toBeInTheDocument());
        expect(screen.getByText('📲 UPI')).toBeInTheDocument();
        expect(screen.getByText('💳 Credit Cards')).toBeInTheDocument();
        expect(screen.getByText('ICICI Amazon')).toBeInTheDocument();
    });

    it('shows the empty state when there are no accounts', async () => {
        vi.mocked(API.getAccounts).mockResolvedValue([]);
        render(<AccountsPage />);
        await waitFor(() => expect(screen.getByText(/No accounts yet/)).toBeInTheDocument());
    });

    it('adds an account, resyncs the vanilla app, and resets the form', async () => {
        const user = userEvent.setup();
        vi.mocked(API.addAccount).mockResolvedValue({ ok: true });
        const loadAccounts = vi.fn().mockResolvedValue(undefined);
        window.app = { loadAccounts };

        render(<AccountsPage />);
        await waitFor(() => expect(screen.getByText('UBI')).toBeInTheDocument());

        await user.type(screen.getByPlaceholderText('e.g., HDFC Millennia'), 'HDFC Millennia');
        await user.selectOptions(screen.getByRole('combobox'), 'credit-card');
        await user.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() =>
            expect(API.addAccount).toHaveBeenCalledWith({ name: 'HDFC Millennia', type: 'credit-card' })
        );
        expect(loadAccounts).toHaveBeenCalledOnce();
        expect(showNotification).toHaveBeenCalledWith('Account added!');
        expect((screen.getByPlaceholderText('e.g., HDFC Millennia') as HTMLInputElement).value).toBe('');
    });

    it('shows an error notification, without resetting, when adding fails', async () => {
        const user = userEvent.setup();
        vi.mocked(API.addAccount).mockRejectedValue(new Error('name is required (max 40 chars)'));

        render(<AccountsPage />);
        await waitFor(() => expect(screen.getByText('UBI')).toBeInTheDocument());

        await user.type(screen.getByPlaceholderText('e.g., HDFC Millennia'), 'X');
        await user.selectOptions(screen.getByRole('combobox'), 'cash');
        await user.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() =>
            expect(showNotification).toHaveBeenCalledWith(
                'Error adding account: name is required (max 40 chars)',
                'error'
            )
        );
    });

    it('deletes an account and resyncs the vanilla app', async () => {
        const user = userEvent.setup();
        vi.mocked(API.deleteAccount).mockResolvedValue({ ok: true });
        const loadAccounts = vi.fn().mockResolvedValue(undefined);
        window.app = { loadAccounts };

        render(<AccountsPage />);
        await waitFor(() => expect(screen.getByText('UBI')).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Remove UBI' }));

        await waitFor(() => expect(API.deleteAccount).toHaveBeenCalledWith(1));
        expect(loadAccounts).toHaveBeenCalledOnce();
        expect(showNotification).toHaveBeenCalledWith('Account removed.');
    });
});
