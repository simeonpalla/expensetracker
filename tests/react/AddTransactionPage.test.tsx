// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddTransactionPage from '../../src/react/pages/AddTransactionPage';
import { notifyAccountsChanged, notifyCategoriesChanged } from '../../src/react/crossPageSync';

vi.mock('../../src/api.js', () => ({
    API: {
        getCategories: vi.fn(),
        getAccounts: vi.fn(),
        addTransaction: vi.fn()
    }
}));
vi.mock('../../src/ui.js', () => ({
    showNotification: vi.fn()
}));

import { API } from '../../src/api.js';
import { showNotification } from '../../src/ui.js';

const mockCategories = [
    { id: 1, name: 'Salary', type: 'income', icon: '💰' },
    { id: 2, name: 'Food', type: 'expense', icon: '🍔' }
];
const mockAccounts = [
    { name: 'UBI', type: 'upi' },
    { name: 'ICICI Amazon', type: 'credit-card' }
];

beforeEach(() => {
    vi.mocked(API.getCategories).mockReset().mockResolvedValue(mockCategories);
    vi.mocked(API.getAccounts).mockReset().mockResolvedValue(mockAccounts);
    vi.mocked(API.addTransaction).mockReset();
    vi.mocked(showNotification).mockReset();
    window.app = undefined;
});

describe('AddTransactionPage', () => {
    it('filters the category dropdown by the selected type', async () => {
        const user = userEvent.setup();
        render(<AddTransactionPage />);
        await waitFor(() => expect(screen.getByRole('option', { name: '💰 Income' })).toBeInTheDocument());

        await user.selectOptions(screen.getByLabelText('Transaction Type'), 'expense');
        expect(screen.getByRole('option', { name: '🍔 Food' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: '💰 Salary' })).not.toBeInTheDocument();
    });

    it('locks payment source/details to Salary Deposit for an income+Salary transaction', async () => {
        const user = userEvent.setup();
        window.app = { salaryAccount: 'UBI' };
        render(<AddTransactionPage />);
        await waitFor(() => expect(screen.getByLabelText('Transaction Type')).toBeInTheDocument());

        await user.selectOptions(screen.getByLabelText('Transaction Type'), 'income');
        await user.selectOptions(screen.getByLabelText('Category'), 'Salary');

        expect(screen.getByLabelText('Payment Source')).toHaveValue('salary');
        expect(screen.getByLabelText('Payment Source')).toBeDisabled();
        expect(screen.getByLabelText('Bank / Card')).toHaveValue('UBI');
        expect(screen.getByLabelText('Bank / Card')).toBeDisabled();
    });

    it('cascades Bank/Card options from the selected payment source', async () => {
        const user = userEvent.setup();
        render(<AddTransactionPage />);
        await waitFor(() => expect(screen.getByLabelText('Payment Source')).toBeInTheDocument());

        await user.selectOptions(screen.getByLabelText('Payment Source'), 'credit-card');
        expect(screen.getByRole('option', { name: 'ICICI Amazon' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'UBI' })).not.toBeInTheDocument();
    });

    it('submits the exact payload shape and resets the form on success', async () => {
        const user = userEvent.setup();
        vi.mocked(API.addTransaction).mockResolvedValue({ ok: true });
        const refreshTransactions = vi.fn().mockResolvedValue(undefined);
        window.app = { refreshTransactions };

        render(<AddTransactionPage />);
        await waitFor(() => expect(screen.getByLabelText('Transaction Type')).toBeInTheDocument());

        await user.selectOptions(screen.getByLabelText('Transaction Type'), 'expense');
        await user.type(screen.getByLabelText('Amount (₹)'), '249.5');
        await user.selectOptions(screen.getByLabelText('Category'), 'Food');
        await user.type(screen.getByLabelText('Payment To'), 'Zomato');
        await user.selectOptions(screen.getByLabelText('Payment Source'), 'upi');
        await user.selectOptions(screen.getByLabelText('Bank / Card'), 'UBI');
        await user.click(screen.getByRole('button', { name: /Save Transaction/ }));

        await waitFor(() =>
            expect(API.addTransaction).toHaveBeenCalledWith({
                type: 'expense',
                amount: 249.5,
                category: 'Food',
                transaction_date: expect.any(String),
                description: null,
                payment_to: 'Zomato',
                payment_source: 'upi',
                source_details: 'UBI',
                is_recurring: false
            })
        );
        expect(refreshTransactions).toHaveBeenCalledOnce();
        expect(showNotification).toHaveBeenCalledWith('Transaction saved!');
        expect(screen.getByLabelText('Payment To')).toHaveValue('');
    });

    it('shows an error notification and keeps the form filled when saving fails', async () => {
        const user = userEvent.setup();
        vi.mocked(API.addTransaction).mockRejectedValue(new Error('amount must be a positive number'));

        render(<AddTransactionPage />);
        await waitFor(() => expect(screen.getByLabelText('Transaction Type')).toBeInTheDocument());

        await user.selectOptions(screen.getByLabelText('Transaction Type'), 'expense');
        await user.type(screen.getByLabelText('Amount (₹)'), '10');
        await user.selectOptions(screen.getByLabelText('Category'), 'Food');
        await user.type(screen.getByLabelText('Payment To'), 'Zomato');
        await user.selectOptions(screen.getByLabelText('Payment Source'), 'cash');
        await user.click(screen.getByRole('button', { name: /Save Transaction/ }));

        await waitFor(() =>
            expect(showNotification).toHaveBeenCalledWith(
                'Error saving transaction: amount must be a positive number',
                'error'
            )
        );
        expect(screen.getByLabelText('Payment To')).toHaveValue('Zomato');
    });

    it('the Clear button resets all fields', async () => {
        const user = userEvent.setup();
        render(<AddTransactionPage />);
        await waitFor(() => expect(screen.getByLabelText('Payment To')).toBeInTheDocument());

        await user.type(screen.getByLabelText('Payment To'), 'Zomato');
        await user.click(screen.getByRole('button', { name: '🔄 Clear' }));

        expect(screen.getByLabelText('Payment To')).toHaveValue('');
    });

    it('refetches categories/accounts when notified of a change elsewhere', async () => {
        render(<AddTransactionPage />);
        await waitFor(() => expect(API.getCategories).toHaveBeenCalledTimes(1));

        vi.mocked(API.getCategories).mockResolvedValue([
            ...mockCategories,
            { id: 3, name: 'Rent', type: 'expense', icon: '🏠' }
        ]);
        notifyCategoriesChanged();
        await waitFor(() => expect(API.getCategories).toHaveBeenCalledTimes(2));

        vi.mocked(API.getAccounts).mockResolvedValue([...mockAccounts, { name: 'HDFC', type: 'upi' }]);
        notifyAccountsChanged();
        await waitFor(() => expect(API.getAccounts).toHaveBeenCalledTimes(2));
    });

    it('is filled by the recurring-suggestion prefill bridge', async () => {
        render(<AddTransactionPage />);
        await waitFor(() => expect(window.__prefillAddTransactionForm).toBeInstanceOf(Function));

        window.__prefillAddTransactionForm?.({
            type: 'expense',
            category: 'Food',
            amount: 499,
            payment_to: 'Netflix',
            payment_source: 'credit-card',
            source_details: 'ICICI Amazon',
            description: null
        });

        await waitFor(() => expect(screen.getByLabelText('Payment To')).toHaveValue('Netflix'));
        expect(screen.getByLabelText('Amount (₹)')).toHaveValue(499);
        expect(screen.getByRole('checkbox')).toBeChecked();
        expect(showNotification).toHaveBeenCalledWith('Form pre-filled from recurring transaction.');
    });
});
