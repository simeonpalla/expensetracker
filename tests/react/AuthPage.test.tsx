// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthPage from '../../src/react/pages/AuthPage';

vi.mock('../../src/api.js', () => ({
    API: { login: vi.fn(), signup: vi.fn(), forgotPassword: vi.fn(), resetPassword: vi.fn() }
}));
import { API } from '../../src/api.js';

const reload = vi.fn();
beforeEach(() => {
    vi.mocked(API.login).mockReset();
    vi.mocked(API.signup).mockReset();
    reload.mockReset();
    Object.defineProperty(window, 'location', { value: { reload }, writable: true });
});

describe('AuthPage', () => {
    it('shows the API error on a failed login and does not reload', async () => {
        const user = userEvent.setup();
        vi.mocked(API.login).mockRejectedValue(new Error('Invalid login credentials'));
        render(<AuthPage />);
        await user.type(screen.getByLabelText('Email Address'), 'a@b.co');
        await user.type(screen.getByLabelText('Password'), 'wrong');
        await user.click(screen.getByRole('button', { name: /Login$/ }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid login credentials'));
        expect(reload).not.toHaveBeenCalled();
    });

    it('reloads the page after a successful login', async () => {
        const user = userEvent.setup();
        vi.mocked(API.login).mockResolvedValue({ user: { id: 'u' } });
        render(<AuthPage />);
        await user.type(screen.getByLabelText('Email Address'), 'a@b.co');
        await user.type(screen.getByLabelText('Password'), 'correct-horse');
        await user.click(screen.getByRole('button', { name: /Login$/ }));
        await waitFor(() => expect(reload).toHaveBeenCalledOnce());
        expect(API.login).toHaveBeenCalledWith('a@b.co', 'correct-horse');
    });

    it('rejects mismatched signup passwords without calling the API', async () => {
        const user = userEvent.setup();
        render(<AuthPage />);
        await user.click(screen.getByRole('tab', { name: 'Sign Up' }));
        await user.type(screen.getByLabelText('Email Address'), 'a@b.co');
        await user.type(screen.getByLabelText('Password'), 'longenough1');
        await user.type(screen.getByLabelText('Confirm Password'), 'different99');
        await user.click(screen.getByRole('button', { name: /Create Account/ }));
        expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
        expect(API.signup).not.toHaveBeenCalled();
    });

    it('shows the confirm-email message when signup needs confirmation', async () => {
        const user = userEvent.setup();
        vi.mocked(API.signup).mockResolvedValue({ needsConfirmation: true });
        render(<AuthPage />);
        await user.click(screen.getByRole('tab', { name: 'Sign Up' }));
        await user.type(screen.getByLabelText('Email Address'), 'a@b.co');
        await user.type(screen.getByLabelText('Password'), 'longenough1');
        await user.type(screen.getByLabelText('Confirm Password'), 'longenough1');
        await user.click(screen.getByRole('button', { name: /Create Account/ }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Check your email'));
        expect(reload).not.toHaveBeenCalled();
    });
});

describe('AuthPage password reset', () => {
    it('sends a reset link request and shows a neutral confirmation', async () => {
        const user = userEvent.setup();
        vi.mocked(API.forgotPassword).mockResolvedValue({ ok: true });
        render(<AuthPage />);
        await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
        await user.type(screen.getByLabelText('Email Address'), 'a@b.co');
        await user.click(screen.getByRole('button', { name: /Send reset link/ }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('reset link is on its way'));
        expect(API.forgotPassword).toHaveBeenCalledWith('a@b.co');
    });

    it('opens the new-password form from a recovery link and strips the token from the URL', async () => {
        const user = userEvent.setup();
        vi.mocked(API.resetPassword).mockResolvedValue({ ok: true });
        const replaceState = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
        Object.defineProperty(window, 'location', {
            value: { reload, hash: '#access_token=abc.def.ghi&type=recovery', pathname: '/', search: '' },
            writable: true
        });

        render(<AuthPage />);
        expect(replaceState).toHaveBeenCalledWith(null, '', '/');
        await user.type(screen.getByLabelText('New Password'), 'brand-new-pass');
        await user.type(screen.getByLabelText('Confirm New Password'), 'brand-new-pass');
        await user.click(screen.getByRole('button', { name: /Set new password/ }));

        await waitFor(() => expect(API.resetPassword).toHaveBeenCalledWith('abc.def.ghi', 'brand-new-pass'));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Password updated'));
        expect(screen.getByRole('button', { name: /Login$/ })).toBeInTheDocument();
        replaceState.mockRestore();
    });
});
