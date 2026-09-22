// AddTransactionPage — React port of the "Add Transaction" form only.
// The #recurring-suggestions widget above it, and the entire Dashboard
// page (transaction list, edit modal, charts, CSV export, cycle
// selection) stay vanilla for now — they're Dashboard-owned and far more
// tightly coupled to each other than to this form. See
// SCALABILITY_ROADMAP.md for why this page was scoped down from the
// original "Add Transaction + Dashboard" plan.
//
// Bridges to the still-vanilla app:
//  - Reads categories/accounts via their own API calls (same pattern as
//    Categories/Budgets), not via window.app, to avoid depending on
//    vanilla state being freshly loaded.
//  - Reads window.app.salaryAccount live at render/submit time (the
//    Dashboard-owned Salary Settings form writes it directly + to
//    localStorage; this form only reads it, never writes it).
//  - After a successful save, calls window.app.refreshTransactions()
//    (new small helper in main.js, replacing 3 duplicated call sites)
//    to refresh the vanilla transaction list/charts/cycle history.
//  - Exposes window.__prefillAddTransactionForm so main.js's
//    prefillFromRecurring() (the Dashboard's "+ Log it" button) can fill
//    this form — native DOM .value assignment can't update
//    React-controlled inputs, so this explicit bridge replaces that.
import { useCallback, useEffect, useState } from 'react';
import PFDates from '../../engine/dates.js';
import { API } from '../../api.js';
import { showNotification } from '../../ui.js';
import { onAccountsChanged, onCategoriesChanged } from '../crossPageSync';

interface Category {
    id: number;
    name: string;
    type: 'income' | 'expense';
    icon: string;
}

const PAYMENT_SOURCES = ['upi', 'credit-card', 'debit-card', 'cash'];

function emptyForm() {
    return {
        type: '',
        amount: '',
        category: '',
        paymentTo: '',
        paymentSource: '',
        sourceDetails: '',
        date: PFDates.todayStr(),
        description: '',
        isRecurring: false
    };
}

export default function AddTransactionPage() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [paymentSources, setPaymentSources] = useState<Record<string, string[]>>({});
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    const refreshCategories = useCallback(async () => {
        const cats: Category[] = (await API.getCategories()) || [];
        setCategories(cats);
    }, []);

    const refreshAccounts = useCallback(async () => {
        const accounts: { name: string; type: string }[] = (await API.getAccounts()) || [];
        const sources: Record<string, string[]> = {};
        accounts.forEach(a => {
            (sources[a.type] ??= []).push(a.name);
        });
        setPaymentSources(sources);
    }, []);

    useEffect(() => {
        refreshCategories();
        refreshAccounts();
        // This form fetches its own copies of categories/accounts rather
        // than sharing state with window.app, so it needs to know when
        // CategoriesPage/AccountsPage change them elsewhere — otherwise a
        // category or account added on another tab wouldn't show up here
        // until a full page reload.
        const offCategories = onCategoriesChanged(refreshCategories);
        const offAccounts = onAccountsChanged(refreshAccounts);
        return () => {
            offCategories();
            offAccounts();
        };
    }, [refreshCategories, refreshAccounts]);

    useEffect(() => {
        window.__prefillAddTransactionForm = tx => {
            setForm({
                type: tx.type,
                amount: String(tx.amount),
                category: tx.category,
                paymentTo: tx.payment_to || '',
                paymentSource: tx.payment_source || '',
                sourceDetails: tx.source_details || '',
                date: PFDates.todayStr(),
                description: tx.description || '',
                isRecurring: true
            });
            showNotification('Form pre-filled from recurring transaction.');
        };
        return () => {
            window.__prefillAddTransactionForm = undefined;
        };
    }, []);

    const isSalary = form.type === 'income' && form.category.trim().toLowerCase().includes('salary');
    const salaryAccount = window.app?.salaryAccount || '';
    const effectivePaymentSource = isSalary ? 'salary' : form.paymentSource;
    const effectiveSourceDetails = isSalary ? salaryAccount : form.sourceDetails;

    const availableDetails = paymentSources[form.paymentSource];
    const showSourceDetails = isSalary || Boolean(form.paymentSource);
    const sourceDetailsRequired = isSalary || Boolean(availableDetails);

    const filteredCategories = categories
        .filter(c => !form.type || c.type === form.type)
        .sort((a, b) => a.name.localeCompare(b.name));

    function update<K extends keyof ReturnType<typeof emptyForm>>(
        key: K,
        value: ReturnType<typeof emptyForm>[K]
    ) {
        setForm(f => ({ ...f, [key]: value }));
    }

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        try {
            await API.addTransaction({
                type: form.type,
                amount: parseFloat(form.amount),
                category: form.category,
                transaction_date: form.date,
                description: form.description || null,
                payment_to: form.paymentTo,
                payment_source: effectivePaymentSource || 'salary',
                source_details: effectiveSourceDetails || salaryAccount,
                is_recurring: form.isRecurring
            });
            setForm(emptyForm());
            await window.app?.refreshTransactions?.();
            showNotification('Transaction saved!');
        } catch (error) {
            showNotification('Error saving transaction: ' + (error as Error).message, 'error');
        } finally {
            setSaving(false);
        }
    }

    return (
        <form id="transaction-form" className="transaction-form" onSubmit={handleSubmit}>
            <div className="form-stack">
                <div className="form-group">
                    <label htmlFor="type">Transaction Type</label>
                    <select
                        id="type"
                        required
                        value={form.type}
                        onChange={e => {
                            const type = e.target.value;
                            // Category no longer matches the new type: clear it,
                            // same as the original's populateCategoryDropdowns()
                            // rebuild wiping the previous selection.
                            setForm(f => ({ ...f, type, category: '' }));
                        }}
                    >
                        <option value="">Select Type</option>
                        <option value="income">💰 Income</option>
                        <option value="expense">💸 Expense</option>
                    </select>
                </div>

                <div className="form-group">
                    <label htmlFor="amount">Amount (₹)</label>
                    <div className="amount-input">
                        <span className="rupee-symbol">₹</span>
                        <input
                            type="number"
                            id="amount"
                            step="0.01"
                            min="0.01"
                            inputMode="decimal"
                            placeholder="0.00"
                            required
                            value={form.amount}
                            onChange={e => update('amount', e.target.value)}
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label htmlFor="category">Category</label>
                    <select
                        id="category"
                        required
                        value={form.category}
                        onChange={e => update('category', e.target.value)}
                    >
                        <option value="">Select Category</option>
                        {filteredCategories.map(c => (
                            <option value={c.name} key={c.id}>
                                {c.icon} {c.name}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="form-group">
                    <label htmlFor="payment-to">Payment To</label>
                    <input
                        type="text"
                        id="payment-to"
                        placeholder="e.g., Zomato, Local Store"
                        required
                        value={form.paymentTo}
                        onChange={e => update('paymentTo', e.target.value)}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="payment-source">Payment Source</label>
                    {isSalary ? (
                        <select id="payment-source" disabled value="salary" onChange={() => {}}>
                            <option value="salary">Salary Deposit</option>
                        </select>
                    ) : (
                        <select
                            id="payment-source"
                            required
                            value={form.paymentSource}
                            onChange={e => update('paymentSource', e.target.value)}
                        >
                            <option value="">Select Source</option>
                            {PAYMENT_SOURCES.map(s => (
                                <option value={s} key={s}>
                                    {s === 'upi'
                                        ? 'UPI'
                                        : s
                                              .split('-')
                                              .map(w => w[0]?.toUpperCase() + w.slice(1))
                                              .join(' ')}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                <div className="form-group" style={{ display: showSourceDetails ? 'block' : 'none' }}>
                    <label htmlFor="source-details">Bank / Card</label>
                    {isSalary ? (
                        <select id="source-details" disabled value={salaryAccount} onChange={() => {}}>
                            <option value={salaryAccount}>{salaryAccount}</option>
                        </select>
                    ) : (
                        <select
                            id="source-details"
                            required={sourceDetailsRequired}
                            value={form.sourceDetails}
                            onChange={e => update('sourceDetails', e.target.value)}
                        >
                            <option value="">Select Details</option>
                            {(availableDetails || []).map(s => (
                                <option value={s} key={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                <div className="form-group">
                    <label htmlFor="date">Transaction Date</label>
                    <input
                        type="date"
                        id="date"
                        required
                        value={form.date}
                        onChange={e => update('date', e.target.value)}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="description">Description (Optional)</label>
                    <textarea
                        id="description"
                        placeholder="Enter transaction details..."
                        value={form.description}
                        onChange={e => update('description', e.target.value)}
                    ></textarea>
                </div>

                <div className="form-group">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            id="is-recurring"
                            checked={form.isRecurring}
                            onChange={e => update('isRecurring', e.target.checked)}
                        />
                        <span className="checkbox-text">
                            🔁 Mark as recurring (will be suggested next cycle)
                        </span>
                    </label>
                </div>
            </div>

            <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? '💾 Saving...' : '💾 Save Transaction'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setForm(emptyForm())}>
                    🔄 Clear
                </button>
            </div>
        </form>
    );
}
