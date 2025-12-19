// services/analytics.service.js

export class AnalyticsService {
    constructor(user, ui) {
        this.user = user;
        this.ui = ui;

        this.lineChart = null;
        this.donutChart = null;

        this.cycles = []; // ✅ cache salary cycles
    }

    /* ---------- INIT ---------- */

    async init() {
        await this.loadCycleHistory();
        this.bindCycleChange(); // ✅ FIX 1
    }

    /* ---------- CYCLE HANDLING ---------- */

    async loadCycleHistory() {
        const selector = document.getElementById('cycle-history');
        if (!selector) return;

        const { data, error } = await supabaseClient
            .from('salary_cycles')
            .select('cycle_start, cycle_end')
            .eq('user_id', this.user.id)
            .order('cycle_start', { ascending: false });

        if (error || !data?.length) {
            selector.innerHTML = '<option>No cycles available</option>';
            return;
        }

        this.cycles = data; // ✅ cache cycles
        selector.innerHTML = '';

        data.forEach((c, idx) => {
            const s = this.prettyDate(c.cycle_start);
            const e = this.prettyDate(c.cycle_end);

            const opt = document.createElement('option');
            opt.value = c.cycle_start; // YYYY-MM-DD
            opt.textContent =
                idx === 0 ? `Current (${s} → ${e})` : `${s} → ${e}`;

            selector.appendChild(opt);
        });

        // Load latest cycle by default
        this.loadAllForCycle(data[0].cycle_start);
    }

    bindCycleChange() {
        const selector = document.getElementById('cycle-history');
        if (!selector) return;

        selector.addEventListener('change', (e) => {
            this.loadAllForCycle(e.target.value);
        });
    }

    loadAllForCycle(cycleStart) {
        this.loadDashboardCycle(cycleStart);
        this.loadLineChart(cycleStart);
        this.loadDonutChart(cycleStart);
    }

    /* ---------- DASHBOARD TOTALS ---------- */

    async loadDashboardCycle(cycleStart) {
        const { data, error } = await supabaseClient
            .from('cycle_aggregates')
            .select('income, expense')
            .eq('user_id', this.user.id)
            .eq('cycle_start', cycleStart)
            .single();

        if (error || !data) {
            this.ui.showNotification('Dashboard data not found', 'warning');
            return;
        }

        document.getElementById('total-income').textContent =
            this.formatCurrency(data.income);

        document.getElementById('total-expenses').textContent =
            this.formatCurrency(data.expense);

        document.getElementById('net-balance').textContent =
            this.formatCurrency(data.income - data.expense);
    }

    /* ---------- LINE CHART ---------- */

    async loadLineChart(cycleStart) {
        const cycle = this.getCachedCycle(cycleStart);
        if (!cycle) return;

        const { data, error } = await supabaseClient.rpc(
            'get_cycle_daily_expenses',
            {
                cycle_start: cycle.cycle_start,
                cycle_end: cycle.cycle_end
            }
        );

        if (error || !data?.length) {
            this.destroyLineChart();
            return;
        }

        const labels = data.map(d =>
            this.prettyDate(d.day)
        );
        const values = data.map(d => d.total_expense);

        this.renderLineChart(labels, values);
    }

    renderLineChart(labels, values) {
        this.destroyLineChart();

        const ctx = document.getElementById('chart')?.getContext('2d');
        if (!ctx) return;

        this.lineChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Daily Expenses',
                    data: values,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
    }

    destroyLineChart() {
        if (this.lineChart) {
            this.lineChart.destroy();
            this.lineChart = null;
        }
    }

    /* ---------- DONUT CHART ---------- */

    async loadDonutChart(cycleStart) {
        const cycle = this.getCachedCycle(cycleStart);
        if (!cycle) return;

        const { data, error } = await supabaseClient.rpc(
            'get_cycle_expense_breakdown',
            {
                cycle_start: cycle.cycle_start,
                cycle_end: cycle.cycle_end
            }
        );

        if (error || !data?.length) {
            this.destroyDonutChart();
            return;
        }

        this.renderDonutChart(
            data.map(d => d.category),
            data.map(d => d.total)
        );
    }

    renderDonutChart(labels, values) {
        this.destroyDonutChart();

        const ctx = document
            .getElementById('expense-donut-chart')
            ?.getContext('2d');

        if (!ctx) return;

        this.donutChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                aspectRatio: 1,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }

    destroyDonutChart() {
        if (this.donutChart) {
            this.donutChart.destroy();
            this.donutChart = null;
        }
    }

    /* ---------- HELPERS ---------- */

    getCachedCycle(cycleStart) {
        return this.cycles.find(
            c => c.cycle_start === cycleStart
        );
    }

    prettyDate(d) {
        return new Date(d).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short'
        });
    }

    formatCurrency(n) {
        return '₹' + Number(n).toLocaleString('en-IN', {
            minimumFractionDigits: 2
        });
    }
}
