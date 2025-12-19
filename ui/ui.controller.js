export class UIController {

    bindAppEvents(app) {
        // logout
        document.getElementById('logout-btn')
            ?.addEventListener('click', () => {
                supabaseClient.auth.signOut();
            });

        // navigation
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const pageId = e.currentTarget.dataset.page;
                this.showPage(pageId);
            });
        });

        // cycle dropdown → dashboard update
        document.getElementById('cycle-history')
            ?.addEventListener('change', (e) => {
                app.analytics.loadDashboardCycle(e.target.value);
            });

        document.getElementById('cycle-history')
            ?.addEventListener('change', (e) => {
                const cycleStart = e.target.value;

                app.analytics.loadDashboardCycle(cycleStart);
                app.analytics.loadLineChart(cycleStart);
                app.analytics.loadDonutChart(cycleStart);
                app.transactions.loadByCycle(cycleStart);
            });

        // local AI
        document.getElementById('generate-local-ai-btn')
            ?.addEventListener('click', () => {
                app.analytics.runLocalInsights();
            });
    }

    showPage(pageId) {
        document.querySelectorAll('.page')
            .forEach(p => p.classList.remove('active'));

        document.getElementById(pageId)
            ?.classList.add('active');
    }

    showNotification(msg, type = 'success') {
        const n = document.getElementById('notification');
        const m = document.getElementById('notification-message');
        if (!n || !m) return;

        m.textContent = msg;
        n.className = `notification ${type} show`;

        setTimeout(() => n.classList.remove('show'), 4000);
    }
}
