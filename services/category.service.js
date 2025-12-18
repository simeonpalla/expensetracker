// services/category.service.js

export class CategoryService {
    constructor(user, ui) {
        this.user = user;
        this.ui = ui;
    }

    async load() {
        const { data } = await supabaseClient
            .from('categories')
            .select('name, type, icon')
            .eq('user_id', this.user.id);

        this.render(data || []);
    }

    render(categories) {
        const income = document.getElementById('income-categories');
        const expense = document.getElementById('expense-categories');
        income.innerHTML = expense.innerHTML = '';

        categories.forEach(c => {
            const el = document.createElement('div');
            el.textContent = `${c.icon} ${c.name}`;
            (c.type === 'income' ? income : expense).appendChild(el);
        });
    }
}
