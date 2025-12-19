// app.js

// ---- Safety Check ----
if (typeof supabaseClient === 'undefined') {
    throw new Error('Supabase client not initialized. Check supabase-config.js');
}

// ---- Imports ----
import { setupAuth } from './auth.js';
import { UIController } from './ui/ui.controller.js';
import { TransactionService } from './services/transaction.service.js';
import { CategoryService } from './services/category.service.js';
import { AnalyticsService } from './services/analytics.service.js';

// ---- Main App Class ----
class ExpenseTrackerApp {
    constructor(user) {
        this.user = user;

        // Core controllers / services
        this.ui = new UIController();
        this.transactions = new TransactionService(user, this.ui);
        this.categories = new CategoryService(user, this.ui);
        this.analytics = new AnalyticsService(user, this.ui);

        // Single controlled entry point
        this.init();
    }

    async init() {
        try {
            // Load reference data first
            await this.categories.load();

            // Init transactional workflows
            await this.transactions.init();

            // Init analytics (salary cycles + dashboard bootstrap)
            await this.analytics.init();

            // Bind UI events AFTER all services exist
            this.ui.bindAppEvents(this);

            console.log('✅ ExpenseTrackerApp initialized successfully');

        } catch (err) {
            console.error('❌ App initialization failed:', err);
            this.ui.showNotification('App failed to load', 'error');
        }
    }
}

// ---- Auth Bootstrap (ONLY PLACE app is created) ----
setupAuth((user) => {
    if (!window.app && user) {
        window.app = new ExpenseTrackerApp(user);
    }
});
