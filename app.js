// app.js

if (typeof supabaseClient === 'undefined') {
    throw new Error('Supabase client not initialized. Check supabase-config.js');
}

import { setupAuth } from './auth.js';
import { UIController } from './ui/ui.controller.js';
import { TransactionService } from './services/transaction.service.js';
import { CategoryService } from './services/category.service.js';
import { AnalyticsService } from './services/analytics.service.js';

class ExpenseTrackerApp {
    constructor(user) {
        this.user = user;
        this.ui = new UIController();
        this.transactions = new TransactionService(user, this.ui);
        this.categories = new CategoryService(user, this.ui);
        this.analytics = new AnalyticsService(user, this.ui);

        this.init();
    }

    async init() {
        await this.categories.load();
        await this.transactions.init();
        await this.analytics.init();
        this.ui.bindAppEvents(this);
    }
}

setupAuth((user) => {
    if (!window.app && user) {
        window.app = new ExpenseTrackerApp(user);
    }
});
