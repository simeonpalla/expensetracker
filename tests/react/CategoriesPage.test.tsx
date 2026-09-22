// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CategoriesPage from '../../src/react/pages/CategoriesPage';

vi.mock('../../src/api.js', () => ({
    API: {
        getCategories: vi.fn(),
        addCategory: vi.fn()
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

beforeEach(() => {
    vi.mocked(API.getCategories).mockReset().mockResolvedValue(mockCategories);
    vi.mocked(API.addCategory).mockReset();
    vi.mocked(showNotification).mockReset();
    window.app = undefined;
});

describe('CategoriesPage', () => {
    it('shows a loading state, then income/expense categories grouped separately', async () => {
        render(<CategoriesPage />);
        expect(screen.getByText('Loading categories...')).toBeInTheDocument();

        await waitFor(() => expect(screen.getByText('Salary')).toBeInTheDocument());
        expect(screen.getByText('💰 Income Categories')).toBeInTheDocument();
        expect(screen.getByText('💸 Expense Categories')).toBeInTheDocument();
        expect(screen.getByText('Food')).toBeInTheDocument();
    });

    it('adds a category with a default icon when none is given, resyncs the vanilla app', async () => {
        const user = userEvent.setup();
        vi.mocked(API.addCategory).mockResolvedValue({ ok: true });
        const loadCategories = vi.fn().mockResolvedValue(undefined);
        window.app = { loadCategories };

        render(<CategoriesPage />);
        await waitFor(() => expect(screen.getByText('Salary')).toBeInTheDocument());

        await user.type(screen.getByPlaceholderText('Category name'), 'Rent');
        await user.selectOptions(screen.getByRole('combobox'), 'expense');
        await user.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() =>
            expect(API.addCategory).toHaveBeenCalledWith({ name: 'Rent', type: 'expense', icon: '📁' })
        );
        expect(loadCategories).toHaveBeenCalledOnce();
        expect(showNotification).toHaveBeenCalledWith('Category added successfully!');
    });

    it('shows an error notification when adding fails', async () => {
        const user = userEvent.setup();
        vi.mocked(API.addCategory).mockRejectedValue(new Error('name is required'));

        render(<CategoriesPage />);
        await waitFor(() => expect(screen.getByText('Salary')).toBeInTheDocument());

        await user.type(screen.getByPlaceholderText('Category name'), 'X');
        await user.selectOptions(screen.getByRole('combobox'), 'income');
        await user.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() =>
            expect(showNotification).toHaveBeenCalledWith('Error adding category: name is required', 'error')
        );
    });
});
