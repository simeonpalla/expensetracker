// services/category.service.js

export class CategoryService {
    constructor(user, ui) {
        this.user = user;
        this.ui = ui;
        this.categories = [];
    }

    async load() {
        const { data, error } = await supabaseClient
            .from('categories')
            .select('name, type, icon')
            .eq('user_id', this.user.id)
            .order('name');

        if (error) {
            this.ui.showNotification('Failed to load categories', 'error');
            return;
        }

        this.categories = data || [];
        this.renderCategories();
    }

    renderCategories() {
        const income = document.getElementById('income-categories');
        const expense = document.getElementById('expense-categories');

        if (!income || !expense) return;

        income.innerHTML = '';
        expense.innerHTML = '';

        this.categories.forEach(c => {
            const el = document.createElement('div');
            el.className = 'category-item';
            el.innerHTML = `
                <span>${c.icon}</span>
                <span class="category-name">${c.name}</span>
                `;
            (c.type === 'income' ? income : expense).appendChild(el);
        });
    }

    updateCategoryDropdown(type) {
        const select = document.getElementById('category');
        if (!select) return;

        select.innerHTML = '<option value="">Select Category</option>';

        this.categories
            .filter(c => c.type === type)
            .forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = `${c.icon} ${c.name}`;
                select.appendChild(opt);
            });
    }
}
