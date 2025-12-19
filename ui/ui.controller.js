// ui/ui.controller.js

export class UIController {

    bindAppEvents(app) {
        document.getElementById('logout-btn')
            ?.addEventListener('click', () => {
                supabaseClient.auth.signOut();
            });

        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', e => {
                document.querySelectorAll('.page')
                    .forEach(p => p.classList.remove('active'));
                document.getElementById(e.currentTarget.dataset.page)
                    ?.classList.add('active');
            });
        });

        // ✅ SINGLE cycle handler
        document.getElementById('cycle-history')
            ?.addEventListener('change', e => {
                app.analytics.loadFullCycle(e.target.value);
            });

        document.getElementById('generate-local-ai-btn')
            ?.addEventListener('click', () => {
                app.analytics.runLocalInsights();
            });
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
