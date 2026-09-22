// AccountsPage — React port of the "Manage Accounts & Cards" page.
// Replaces the vanilla renderAccountsUI()/handleAccountSubmit()/
// deleteAccount() methods that used to live in main.js. Reuses the
// existing CSS classes (categories-section, category-group, etc.) so no
// stylesheet changes were needed.
//
// This page's accounts list also feeds dropdowns elsewhere in the still-
// vanilla app (transaction payment-source, salary-account select), owned
// by ExpenseTracker.loadAccounts() in main.js. After any add/delete here,
// window.app.loadAccounts() is called to keep those in sync — the two
// data fetches (this component's own + the vanilla one) are intentionally
// separate rather than sharing state, since this island and the vanilla
// app don't share a store during the page-by-page migration.
import { useCallback, useEffect, useState } from 'react';
import { API } from '../../api.js';
import { showNotification } from '../../ui.js';

type AccountType = 'upi' | 'debit-card' | 'credit-card' | 'cash';

interface Account {
    id: number;
    name: string;
    type: AccountType;
}

const TYPE_LABELS: Record<AccountType, string> = {
    upi: '📲 UPI',
    'debit-card': '💳 Debit Cards',
    'credit-card': '💳 Credit Cards',
    cash: '💵 Cash'
};

export default function AccountsPage() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState('');
    const [type, setType] = useState<AccountType | ''>('');

    const load = useCallback(async () => {
        const data = await API.getAccounts();
        setAccounts(data || []);
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        try {
            await API.addAccount({ name: name.trim(), type });
            await load();
            await window.app?.loadAccounts?.();
            setName('');
            setType('');
            showNotification('Account added!');
        } catch (error) {
            showNotification('Error adding account: ' + (error as Error).message, 'error');
        }
    }

    async function handleDelete(id: number) {
        try {
            await API.deleteAccount(id);
            await load();
            await window.app?.loadAccounts?.();
            showNotification('Account removed.');
        } catch (error) {
            showNotification('Error removing account: ' + (error as Error).message, 'error');
        }
    }

    const typesPresent = (Object.keys(TYPE_LABELS) as AccountType[]).filter(t =>
        accounts.some(a => a.type === t)
    );

    return (
        <>
            <div className="add-category-form">
                <h3>Add New Account</h3>
                <form onSubmit={handleSubmit}>
                    <div className="form-row">
                        <input
                            type="text"
                            placeholder="e.g., HDFC Millennia"
                            required
                            maxLength={40}
                            value={name}
                            onChange={e => setName(e.target.value)}
                        />
                        <select
                            required
                            aria-label="Account type"
                            value={type}
                            onChange={e => setType(e.target.value as AccountType)}
                        >
                            <option value="">Type</option>
                            <option value="upi">UPI</option>
                            <option value="debit-card">Debit Card</option>
                            <option value="credit-card">Credit Card</option>
                            <option value="cash">Cash</option>
                        </select>
                        <button type="submit" className="btn btn-primary">
                            Add
                        </button>
                    </div>
                </form>
            </div>
            <div className="categories-display">
                {loading ? (
                    <p className="loading">Loading accounts...</p>
                ) : accounts.length === 0 ? (
                    <p style={{ color: 'var(--text2)', fontSize: '0.9rem' }}>
                        No accounts yet — add your first bank, UPI ID, or card above.
                    </p>
                ) : (
                    typesPresent.map(t => (
                        <div className="category-group" key={t}>
                            <h4>{TYPE_LABELS[t]}</h4>
                            <div className="category-grid">
                                {accounts
                                    .filter(a => a.type === t)
                                    .map(a => (
                                        <div className="category-item account-item" key={a.id}>
                                            <span className="category-name">{a.name}</span>
                                            <button
                                                type="button"
                                                className="account-delete-btn"
                                                aria-label={`Remove ${a.name}`}
                                                onClick={() => handleDelete(a.id)}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </>
    );
}
