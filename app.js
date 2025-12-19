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
        this.categoryService = new CategoryService(user, this.ui);
        this.transactionService = new TransactionService(
            user,
            this.ui,
            this.categoryService
        );
        this.analyticsService = new AnalyticsService(user, this.ui, this.transactionService);

        this.init();
    }

    async init() {
        await this.categoryService.load();
        await this.transactionService.init();
        await this.analyticsService.init();

        this.ui.bindAppEvents(this);
    }
}

setupAuth((user) => {
    if (user && !window.app) {
        window.app = new ExpenseTrackerApp(user);
    }
});
