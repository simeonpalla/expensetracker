// ui/ui.controller.js

export class UIController {
    showNotification(msg, type = 'success') {
        const el = document.getElementById('notification');
        document.getElementById('notification-message').textContent = msg;
        el.className = `notification ${type} show`;
        setTimeout(() => el.classList.remove('show'), 4000);
    }

    bindAppEvents(app) {
        document.getElementById('logout-btn')
            .addEventListener('click', () => supabaseClient.auth.signOut());

        document.querySelectorAll('.nav-tab').forEach(btn => {
            btn.addEventListener('click', e => this.showPage(e.target.dataset.page));
        });

        document.getElementById('generate-local-ai-btn')
            .addEventListener('click', () => app.analytics.runLocalInsights());
    }

    showPage(id) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    }
}
