// CategoriesPage — React port of the "Manage Categories" page.
// Replaces the vanilla displayCategories()/handleCategorySubmit() methods
// that used to live in main.js. No delete here — the vanilla version
// never had one, and neither does the backend (categories.js only
// implements GET/POST), so this preserves that exactly rather than
// silently adding capability.
//
// this.categories also feeds dropdowns/budgets elsewhere in the still-
// vanilla app, owned by ExpenseTracker.loadCategories() in main.js. After
// adding a category, window.app.loadCategories() is called to keep those
// in sync — same pattern as AccountsPage.
import { useCallback, useEffect, useState } from 'react';
import { API } from '../../api.js';
import { showNotification } from '../../ui.js';
import { notifyCategoriesChanged } from '../crossPageSync';

type CategoryType = 'income' | 'expense';

interface Category {
    id: number;
    name: string;
    type: CategoryType;
    icon: string;
}

export default function CategoriesPage() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState('');
    const [type, setType] = useState<CategoryType | ''>('');
    const [icon, setIcon] = useState('');

    const load = useCallback(async () => {
        const data: Category[] = (await API.getCategories()) || [];
        data.sort((a, b) => a.name.localeCompare(b.name));
        setCategories(data);
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        try {
            await API.addCategory({ name: name.trim(), type, icon: icon.trim() || '📁' });
            await load();
            await window.app?.loadCategories?.();
            notifyCategoriesChanged();
            setName('');
            setType('');
            setIcon('');
            showNotification('Category added successfully!');
        } catch (error) {
            showNotification('Error adding category: ' + (error as Error).message, 'error');
        }
    }

    const income = categories.filter(c => c.type === 'income');
    const expense = categories.filter(c => c.type === 'expense');

    return (
        <>
            <div className="add-category-form">
                <h3>Add New Category</h3>
                <form onSubmit={handleSubmit}>
                    <div className="form-row">
                        <input
                            type="text"
                            placeholder="Category name"
                            required
                            value={name}
                            onChange={e => setName(e.target.value)}
                        />
                        <select
                            required
                            aria-label="Category type"
                            value={type}
                            onChange={e => setType(e.target.value as CategoryType)}
                        >
                            <option value="">Type</option>
                            <option value="income">Income</option>
                            <option value="expense">Expense</option>
                        </select>
                        <input
                            type="text"
                            placeholder="Emoji"
                            maxLength={2}
                            value={icon}
                            onChange={e => setIcon(e.target.value)}
                        />
                        <button type="submit" className="btn btn-primary">
                            Add
                        </button>
                    </div>
                </form>
            </div>
            <div className="categories-display">
                {loading ? (
                    <p className="loading">Loading categories...</p>
                ) : (
                    <>
                        <div className="category-group">
                            <h4>💰 Income Categories</h4>
                            <div className="category-grid">
                                {income.map(c => (
                                    <div className="category-item" key={c.id}>
                                        <span className="category-icon">{c.icon}</span>
                                        <span className="category-name">{c.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="category-group">
                            <h4>💸 Expense Categories</h4>
                            <div className="category-grid">
                                {expense.map(c => (
                                    <div className="category-item" key={c.id}>
                                        <span className="category-icon">{c.icon}</span>
                                        <span className="category-name">{c.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
