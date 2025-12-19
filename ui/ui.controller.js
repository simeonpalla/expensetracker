// ui/ui.controller.js

export class UIController {
    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        const msg = document.getElementById('notification-message');

        msg.textContent = message;
        notification.className = `notification ${type} show`;

        setTimeout(() => notification.classList.remove('show'), 4000);
    }

    bindAppEvents(app) {
        document.getElementById('logout-btn')
            .addEventListener('click', () => supabaseClient.auth.signOut());

        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const page = e.currentTarget.dataset.page;
                this.showPage(page);
            });
        });

        document.getElementById('generate-local-ai-btn')
            ?.addEventListener('click', () => {
                app.analyticsService.runLocalInsights();
            });
    }

    showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(pageId)?.classList.add('active');

        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-page="${pageId}"]`)?.classList.add('active');
    }

    prettyDate(d) {
        return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }

    formatCurrency(n) {
        return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    }

}
