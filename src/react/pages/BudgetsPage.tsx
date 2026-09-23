// BudgetsPage — React port of renderBudgetLimitsUI()/saveBudgetLimits()
// and the Giving Floor form's inline handler.
//
// Budget limits and the giving floor are per-user settings stored in the
// user_settings table (see netlify/functions/settings.js), so they follow
// the account across devices. Saving PUTs to the server, then mutates
// window.app's copies (read by DashboardPage) and asks it to recompute.
import { useCallback, useEffect, useRef, useState } from 'react';
import { API } from '../../api.js';
import { showNotification } from '../../ui.js';
import { onCategoriesChanged, onSettingsChanged } from '../crossPageSync';

interface Category {
    id: number;
    name: string;
    type: 'income' | 'expense';
    icon: string;
}

function currentLimits(): Record<string, number> {
    return window.app?.budgetLimits ?? {};
}

export default function BudgetsPage() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [limits, setLimits] = useState<Record<string, string>>({});
    const [floorPct, setFloorPct] = useState(() => String(window.app?.givingFloorPct ?? 5));
    const [floorCategory, setFloorCategory] = useState(() => window.app?.givingFloorCategory ?? '');
    // A ref, not a useCallback dependency, so refreshCategories (below)
    // stays a stable function reference (registered once with
    // onCategoriesChanged) while still reading the latest floorCategory
    // instead of a stale closure from whenever it was first created.
    const floorCategoryRef = useRef(floorCategory);
    useEffect(() => {
        floorCategoryRef.current = floorCategory;
    }, [floorCategory]);

    const refreshCategories = useCallback(async () => {
        const data: Category[] = (await API.getCategories()) || [];
        setCategories(data);

        const stored = currentLimits();
        const initial: Record<string, string> = {};
        data.filter(c => c.type === 'expense').forEach(c => {
            initial[c.name] = stored[c.name] ? String(stored[c.name]) : '';
        });
        setLimits(initial);

        // Same first-time auto-guess as the original: only when nothing
        // is saved yet, and it mutates window.app's in-memory value
        // immediately (affects the Dashboard's giving-floor warning
        // even before this form is explicitly saved).
        if (!floorCategoryRef.current) {
            const guess = data.find(
                c => c.type === 'expense' && /offering|tithe|giving|donation/i.test(c.name)
            );
            if (guess) {
                setFloorCategory(guess.name);
                if (window.app) window.app.givingFloorCategory = guess.name;
            }
        }

        setLoading(false);
    }, []);

    useEffect(() => {
        refreshCategories();
        // CategoriesPage mounts once at boot too, so this needs to know
        // when a category is added there — same reasoning as
        // AddTransactionPage's onCategoriesChanged usage.
        return onCategoriesChanged(refreshCategories);
    }, [refreshCategories]);

    // Settings arrive from the server after this island mounts; pick them up.
    useEffect(
        () =>
            onSettingsChanged(() => {
                setFloorPct(String(window.app?.givingFloorPct ?? 5));
                setFloorCategory(window.app?.givingFloorCategory ?? '');
                refreshCategories();
            }),
        [refreshCategories]
    );

    function resyncDashboard() {
        const start = window.app?.currentCycleStart;
        if (start) window.app?.updateDashboardStats?.(start, window.app?.currentCycleEnd ?? null);
    }

    async function handleSaveLimits(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const next: Record<string, number> = {};
        Object.entries(limits).forEach(([cat, raw]) => {
            const val = parseFloat(raw);
            if (val > 0) next[cat] = val;
        });
        try {
            await API.saveSettings({ budget_limits: next });
        } catch (err) {
            showNotification('Could not save budget limits: ' + (err as Error).message, 'error');
            return;
        }
        if (window.app) window.app.budgetLimits = next;
        showNotification('Budget limits saved!');
        resyncDashboard();
    }

    async function handleSaveFloor(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const parsed = parseFloat(floorPct);
        const pct = parsed >= 0 ? parsed : 5;
        try {
            await API.saveSettings({ giving_floor_pct: pct, giving_floor_category: floorCategory });
        } catch (err) {
            showNotification('Could not save giving floor: ' + (err as Error).message, 'error');
            return;
        }
        if (window.app) {
            window.app.givingFloorPct = pct;
            window.app.givingFloorCategory = floorCategory;
        }
        setFloorPct(String(pct));
        showNotification('Giving floor saved!');
        resyncDashboard();
    }

    const expenseCategories = categories.filter(c => c.type === 'expense');

    return (
        <>
            <h2>🎯 Budget Limits</h2>
            <p className="page-subtitle">
                Set monthly spending limits per category. Warnings appear when you hit 80%.
            </p>
            <form className="transaction-form" onSubmit={handleSaveLimits}>
                <div className="budget-limits-container">
                    {loading ? (
                        <p className="loading">Loading categories...</p>
                    ) : expenseCategories.length === 0 ? (
                        <p style={{ color: 'var(--text2)', fontSize: '0.9rem' }}>
                            Add expense categories first.
                        </p>
                    ) : (
                        expenseCategories.map(c => (
                            <div className="budget-limit-row" key={c.id}>
                                <label htmlFor={`budget-limit-${c.id}`}>
                                    {c.icon} {c.name}
                                </label>
                                <div className="budget-input-wrap">
                                    <span className="rupee-symbol">₹</span>
                                    <input
                                        id={`budget-limit-${c.id}`}
                                        type="number"
                                        min="0"
                                        step="1"
                                        inputMode="numeric"
                                        className="budget-limit-input"
                                        placeholder="No limit"
                                        value={limits[c.name] ?? ''}
                                        onChange={e => setLimits({ ...limits, [c.name]: e.target.value })}
                                    />
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <div className="form-actions" style={{ marginTop: 20 }}>
                    <button type="submit" className="btn btn-primary">
                        💾 Save Budget Limits
                    </button>
                </div>
            </form>

            <h3 style={{ marginTop: 28 }}>🙏 Giving Floor</h3>
            <p className="page-subtitle">
                Pick a category that should never fall below a % of cycle income — it can go higher, never
                lower.
            </p>
            <form className="transaction-form" onSubmit={handleSaveFloor}>
                <div className="form-row">
                    <div className="form-group" style={{ maxWidth: 220 }}>
                        <label htmlFor="giving-floor-category">Category</label>
                        <select
                            id="giving-floor-category"
                            value={floorCategory}
                            onChange={e => setFloorCategory(e.target.value)}
                        >
                            <option value="">None</option>
                            {expenseCategories.map(c => (
                                <option value={c.name} key={c.id}>
                                    {c.icon} {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group" style={{ maxWidth: 160 }}>
                        <label htmlFor="giving-floor-pct">Minimum % of income</label>
                        <input
                            id="giving-floor-pct"
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            inputMode="decimal"
                            value={floorPct}
                            onChange={e => setFloorPct(e.target.value)}
                        />
                    </div>
                </div>
                <div className="form-actions">
                    <button type="submit" className="btn btn-secondary">
                        💾 Save Floor
                    </button>
                </div>
            </form>
        </>
    );
}
