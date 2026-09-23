// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountPage from '../../src/react/pages/AccountPage';
import OnboardingCard from '../../src/react/pages/OnboardingCard';

vi.mock('../../src/api.js', () => ({
    API: {
        exportAccount: vi.fn(),
        deleteMyAccount: vi.fn(),
        onboard: vi.fn(),
        addAccount: vi.fn(),
        saveSettings: vi.fn()
    }
}));
vi.mock('../../src/ui.js', () => ({ showNotification: vi.fn() }));

import { API } from '../../src/api.js';
import { showNotification } from '../../src/ui.js';

const reload = vi.fn();
beforeEach(() => {
    for (const fn of Object.values(API)) (fn as ReturnType<typeof vi.fn>).mockReset();
    vi.mocked(showNotification).mockReset();
    reload.mockReset();
    Object.defineProperty(window, 'location', { value: { reload }, writable: true });
    window.app = undefined;
});

describe('AccountPage', () => {
    it('keeps the delete button disabled until DELETE is typed, then deletes and reloads', async () => {
        const user = userEvent.setup();
        vi.mocked(API.deleteMyAccount).mockResolvedValue({ ok: true });
        render(<AccountPage />);

        const btn = screen.getByRole('button', { name: /Delete my account/ });
        expect(btn).toBeDisabled();
        await user.type(screen.getByLabelText('Type DELETE to confirm'), 'delete');
        expect(btn).toBeDisabled();
        await user.clear(screen.getByLabelText('Type DELETE to confirm'));
        await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
        expect(btn).toBeEnabled();

        await user.click(btn);
        await waitFor(() => expect(reload).toHaveBeenCalledOnce());
        expect(API.deleteMyAccount).toHaveBeenCalledOnce();
    });

    it('does not reload and reports the error when deletion fails', async () => {
        const user = userEvent.setup();
        vi.mocked(API.deleteMyAccount).mockRejectedValue(new Error('nope'));
        render(<AccountPage />);
        await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
        await user.click(screen.getByRole('button', { name: /Delete my account/ }));
        await waitFor(() =>
            expect(showNotification).toHaveBeenCalledWith('Could not delete account: nope', 'error')
        );
        expect(reload).not.toHaveBeenCalled();
    });

    it('exports the account data as a downloadable JSON file', async () => {
        const user = userEvent.setup();
        vi.mocked(API.exportAccount).mockResolvedValue({ transactions: [] });
        const createObjectURL = vi.fn(() => 'blob:x');
        Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        render(<AccountPage />);
        await user.click(screen.getByRole('button', { name: /Download my data/ }));
        await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Export downloaded.'));
        expect(createObjectURL).toHaveBeenCalledOnce();
        expect(click).toHaveBeenCalledOnce();
        click.mockRestore();
    });
});

describe('OnboardingCard', () => {
    it('renders nothing for an existing user', () => {
        window.app = { needsOnboarding: false };
        const { container } = render(<OnboardingCard />);
        expect(container).toBeEmptyDOMElement();
    });

    it('seeds defaults, registers the salary bank, and hides itself', async () => {
        const user = userEvent.setup();
        vi.mocked(API.onboard).mockResolvedValue({ ok: true, seeded: true });
        vi.mocked(API.addAccount).mockResolvedValue({ ok: true });
        vi.mocked(API.saveSettings).mockResolvedValue({ ok: true });
        const loadCategories = vi.fn().mockResolvedValue(undefined);
        const loadAccounts = vi.fn().mockResolvedValue(undefined);
        window.app = { needsOnboarding: true, loadCategories, loadAccounts };

        const { container } = render(<OnboardingCard />);
        await user.type(screen.getByLabelText(/Bank your salary lands in/), 'HDFC');
        await user.click(screen.getByRole('button', { name: /Set up with defaults/ }));

        await waitFor(() => expect(container).toBeEmptyDOMElement());
        expect(API.onboard).toHaveBeenCalledOnce();
        expect(API.addAccount).toHaveBeenCalledWith({ name: 'HDFC', type: 'upi' });
        expect(API.saveSettings).toHaveBeenCalledWith({ salary_account: 'HDFC' });
        expect(loadCategories).toHaveBeenCalled();
        expect(window.app?.needsOnboarding).toBe(false);
    });

    it('Skip stamps onboarding without seeding anything', async () => {
        const user = userEvent.setup();
        vi.mocked(API.saveSettings).mockResolvedValue({ ok: true });
        window.app = { needsOnboarding: true };
        const { container } = render(<OnboardingCard />);
        await user.click(screen.getByRole('button', { name: 'Skip' }));
        await waitFor(() => expect(container).toBeEmptyDOMElement());
        expect(API.onboard).not.toHaveBeenCalled();
    });
});
