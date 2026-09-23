// AuthPage — React port of the login/signup screen, plus password reset.
// Only loaded (dynamic import from main.js boot()) when the session check
// finds no user, so signed-in visits never download it. Login/signup
// element ids, API calls and the full-page reload after success are
// unchanged from the vanilla version: the reload is what boots the
// signed-in app, so nothing else depends on React state here.
//
// Password reset: "Forgot password?" emails a link (forgot-password.js).
// That link returns here with a short-lived recovery token in the URL
// fragment (#access_token=…&type=recovery); it is read once, stripped from
// the address bar, sent only to reset-password.js, and never stored.
import { useState } from 'react';
import { API } from '../../api.js';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

function readRecoveryToken(): string {
    const params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    if (params.get('type') !== 'recovery') return '';
    return params.get('access_token') || '';
}

export default function AuthPage() {
    const [recoveryToken] = useState(() => {
        const token = readRecoveryToken();
        if (token) history.replaceState(null, '', location.pathname + location.search);
        return token;
    });
    const [mode, setMode] = useState<Mode>(recoveryToken ? 'reset' : 'login');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [busy, setBusy] = useState(false);
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [signupEmail, setSignupEmail] = useState('');
    const [signupPassword, setSignupPassword] = useState('');
    const [signupConfirm, setSignupConfirm] = useState('');
    const [forgotEmail, setForgotEmail] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newConfirm, setNewConfirm] = useState('');

    function switchMode(next: Mode) {
        setMode(next);
        setError('');
        setSuccess('');
    }

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            const data = await API.login(loginEmail, loginPassword);
            if (!data || !data.user) throw new Error('Login failed. Please check your credentials.');
            location.reload();
        } catch (err) {
            setError((err as Error).message || 'An error occurred during login.');
            setBusy(false);
        }
    }

    async function handleSignup(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        if (signupPassword !== signupConfirm) {
            setError('Passwords do not match.');
            return;
        }
        if (signupPassword.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }
        setBusy(true);
        try {
            const data = await API.signup(signupEmail, signupPassword);
            if (data && data.needsConfirmation) {
                setSuccess('Account created! Check your email to confirm, then log in.');
                setSignupEmail('');
                setSignupPassword('');
                setSignupConfirm('');
                setBusy(false);
            } else if (data && data.user) {
                location.reload();
            } else {
                throw new Error('Signup failed.');
            }
        } catch (err) {
            setError((err as Error).message || 'An error occurred during signup.');
            setBusy(false);
        }
    }

    async function handleForgot(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            await API.forgotPassword(forgotEmail);
            setSuccess('If that email has an account, a reset link is on its way.');
            setForgotEmail('');
        } catch (err) {
            setError((err as Error).message || 'Could not send the reset email.');
        } finally {
            setBusy(false);
        }
    }

    async function handleReset(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        if (newPassword !== newConfirm) {
            setError('Passwords do not match.');
            return;
        }
        if (newPassword.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }
        setBusy(true);
        try {
            await API.resetPassword(recoveryToken, newPassword);
            setNewPassword('');
            setNewConfirm('');
            setMode('login');
            setSuccess('Password updated. Log in with your new password.');
        } catch (err) {
            setError((err as Error).message || 'This reset link is invalid or has expired.');
        } finally {
            setBusy(false);
        }
    }

    const showTabs = mode === 'login' || mode === 'signup';

    return (
        <div className="auth-form">
            <h2>💰 Expense Tracker</h2>
            {showTabs && (
                <div className="auth-tabs" role="tablist">
                    <button
                        type="button"
                        className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
                        role="tab"
                        id="login-tab-btn"
                        aria-selected={mode === 'login'}
                        onClick={() => switchMode('login')}
                    >
                        Login
                    </button>
                    <button
                        type="button"
                        className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
                        role="tab"
                        id="signup-tab-btn"
                        aria-selected={mode === 'signup'}
                        onClick={() => switchMode('signup')}
                    >
                        Sign Up
                    </button>
                </div>
            )}
            <div
                id="auth-error"
                className="auth-error"
                role="alert"
                style={{ display: error ? 'block' : 'none' }}
            >
                {error}
            </div>
            <div
                id="auth-success"
                className="auth-success"
                role="status"
                style={{ display: success ? 'block' : 'none' }}
            >
                {success}
            </div>

            {mode === 'login' && (
                <form id="login-form" onSubmit={handleLogin}>
                    <div className="form-group">
                        <label htmlFor="login-email">Email Address</label>
                        <input
                            type="email"
                            id="login-email"
                            required
                            autoComplete="email"
                            value={loginEmail}
                            onChange={e => setLoginEmail(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="login-password">Password</label>
                        <input
                            type="password"
                            id="login-password"
                            required
                            autoComplete="current-password"
                            value={loginPassword}
                            onChange={e => setLoginPassword(e.target.value)}
                        />
                    </div>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                        disabled={busy}
                    >
                        {busy ? '⏳ Signing in...' : '🔓 Login'}
                    </button>
                    <button
                        type="button"
                        id="forgot-link"
                        className="auth-link"
                        onClick={() => switchMode('forgot')}
                    >
                        Forgot password?
                    </button>
                </form>
            )}

            {mode === 'signup' && (
                <form id="signup-form" onSubmit={handleSignup}>
                    <div className="form-group">
                        <label htmlFor="signup-email">Email Address</label>
                        <input
                            type="email"
                            id="signup-email"
                            required
                            autoComplete="email"
                            value={signupEmail}
                            onChange={e => setSignupEmail(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="signup-password">Password</label>
                        <input
                            type="password"
                            id="signup-password"
                            required
                            minLength={8}
                            autoComplete="new-password"
                            value={signupPassword}
                            onChange={e => setSignupPassword(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="signup-confirm">Confirm Password</label>
                        <input
                            type="password"
                            id="signup-confirm"
                            required
                            minLength={8}
                            autoComplete="new-password"
                            value={signupConfirm}
                            onChange={e => setSignupConfirm(e.target.value)}
                        />
                    </div>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                        disabled={busy}
                    >
                        {busy ? '⏳ Creating account...' : '📝 Create Account'}
                    </button>
                    <p className="auth-legal">
                        By creating an account you agree to the <a href="/terms.html">Terms</a> and{' '}
                        <a href="/privacy.html">Privacy Policy</a>.
                    </p>
                </form>
            )}

            {mode === 'forgot' && (
                <form id="forgot-form" onSubmit={handleForgot}>
                    <p className="form-help">
                        Enter your email and we&apos;ll send you a link to choose a new password.
                    </p>
                    <div className="form-group">
                        <label htmlFor="forgot-email">Email Address</label>
                        <input
                            type="email"
                            id="forgot-email"
                            required
                            autoComplete="email"
                            value={forgotEmail}
                            onChange={e => setForgotEmail(e.target.value)}
                        />
                    </div>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                        disabled={busy}
                    >
                        {busy ? '⏳ Sending...' : '✉️ Send reset link'}
                    </button>
                    <button type="button" className="auth-link" onClick={() => switchMode('login')}>
                        Back to login
                    </button>
                </form>
            )}

            {mode === 'reset' && (
                <form id="reset-form" onSubmit={handleReset}>
                    <p className="form-help">Choose a new password for your account.</p>
                    <div className="form-group">
                        <label htmlFor="reset-password">New Password</label>
                        <input
                            type="password"
                            id="reset-password"
                            required
                            minLength={8}
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="reset-confirm">Confirm New Password</label>
                        <input
                            type="password"
                            id="reset-confirm"
                            required
                            minLength={8}
                            autoComplete="new-password"
                            value={newConfirm}
                            onChange={e => setNewConfirm(e.target.value)}
                        />
                    </div>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                        disabled={busy}
                    >
                        {busy ? '⏳ Saving...' : '🔑 Set new password'}
                    </button>
                </form>
            )}
        </div>
    );
}
