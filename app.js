// app.js

if (typeof supabaseClient === 'undefined') {
    throw new Error('Supabase client not initialized');
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
        await this.analytics.init(this.transactions);
        this.ui.bindAppEvents(this);

        console.log('✅ App ready');
    }
}

setupAuth(user => {
    if (user && !window.app) {
        window.app = new ExpenseTrackerApp(user);
    }
});
