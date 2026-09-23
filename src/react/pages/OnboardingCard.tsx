// OnboardingCard — first-run setup for a brand-new account, shown above the
// Add Transaction form only when main.js decides the account is empty
// (window.app.needsOnboarding: no settings stamp, no categories, no
// transactions). Existing users never see it.
//
// "Set up" seeds default categories + a Cash account server-side
// (netlify/functions/onboarding.js, idempotent), optionally registers the
// bank the salary lands in, then refreshes the shared state.
import { useEffect, useState } from 'react';
import { API } from '../../api.js';
import { showNotification } from '../../ui.js';
import { notifyAccountsChanged, notifyCategoriesChanged, onSettingsChanged } from '../crossPageSync';

export default function OnboardingCard() {
    const [visible, setVisible] = useState(() => Boolean(window.app?.needsOnboarding));
    const [bank, setBank] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => onSettingsChanged(() => setVisible(Boolean(window.app?.needsOnboarding))), []);

    async function finish(withDefaults: boolean) {
        setBusy(true);
        try {
            if (withDefaults) {
                await API.onboard();
                const name = bank.trim();
                if (name) {
                    await API.addAccount({ name, type: 'upi' });
                    await API.saveSettings({ salary_account: name });
                    if (window.app) window.app.salaryAccount = name;
                }
                await window.app?.loadCategories?.();
                await window.app?.loadAccounts?.();
                notifyCategoriesChanged();
                notifyAccountsChanged();
            } else {
                // Skip still stamps onboarding so the card never returns.
                await API.saveSettings({ salary_account: window.app?.salaryAccount || 'UBI' });
            }
            if (window.app) window.app.needsOnboarding = false;
            setVisible(false);
            if (withDefaults) showNotification('All set — add your first transaction!');
        } catch (err) {
            showNotification('Setup failed: ' + (err as Error).message, 'error');
        } finally {
            setBusy(false);
        }
    }

    if (!visible) return null;

    return (
        <section className="onboarding-card" aria-labelledby="onboarding-title">
            <h3 id="onboarding-title">👋 Welcome — let&apos;s set you up</h3>
            <p className="form-help">
                We&apos;ll add a starter set of categories (Salary, Food, Rent, Transport…) and a Cash
                account. You can rename or add more any time.
            </p>
            <div className="form-group">
                <label htmlFor="onboarding-bank">Bank your salary lands in (optional)</label>
                <input
                    id="onboarding-bank"
                    type="text"
                    maxLength={60}
                    placeholder="e.g. HDFC"
                    value={bank}
                    onChange={e => setBank(e.target.value)}
                />
            </div>
            <div className="form-actions">
                <button className="btn btn-primary" disabled={busy} onClick={() => finish(true)}>
                    {busy ? 'Setting up…' : '✨ Set up with defaults'}
                </button>
                <button className="btn btn-secondary" disabled={busy} onClick={() => finish(false)}>
                    Skip
                </button>
            </div>
        </section>
    );
}
