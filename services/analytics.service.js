// services/analytics.service.js

export class AnalyticsService {
    constructor(user, ui) {
        this.user = user;
        this.ui = ui;
        this.lineChart = null;
        this.donutChart = null;
    }

    /* ---------- INIT ---------- */

    async init() {
        await this.loadCycleHistory();
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

        selector.innerHTML = '';

        data.forEach((c, idx) => {
            const s = new Date(c.cycle_start).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short'
            });
            const e = new Date(c.cycle_end).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short'
            });

            const opt = document.createElement('option');
            opt.value = c.cycle_start; // IMPORTANT: raw YYYY-MM-DD
            opt.textContent = idx === 0
                ? `Current (${s} → ${e})`
                : `${s} → ${e}`;

            selector.appendChild(opt);
        });

        // Load latest cycle by default
        this.loadAllForCycle(data[0].cycle_start);
    }

    async loadAllForCycle(cycleStart) {
        await Promise.all([
            this.loadDashboardCycle(cycleStart),
            this.loadLineChart(cycleStart),
            this.loadDonutChart(cycleStart)
        ]);
    }

    /* ---------- DASHBOARD TOTALS ---------- */

    async loadDashboardCycle(cycleStart) {
        const cycleStartDate = this.normalizeDate(cycleStart);

        const { data, error } = await supabaseClient
            .from('cycle_aggregates')
            .select('income, expense')
            .eq('user_id', this.user.id)
            .eq('cycle_start', cycleStartDate)
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
        const cycle = await this.getCycleWindow(cycleStart);
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
            new Date(d.day).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short'
            })
        );
        const values = data.map(d => d.total_expense);

        this.renderLineChart(labels, values);
    }

    renderLineChart(labels, values) {
        this.destroyLineChart();

        const ctx = document.getElementById('chart').getContext('2d');

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
        const cycle = await this.getCycleWindow(cycleStart);
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
            .getContext('2d');

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
                    legend: {
                        position: 'bottom'
                    }
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

    async getCycleWindow(cycleStart) {
        const cycleStartDate = this.normalizeDate(cycleStart);

        const { data } = await supabaseClient
            .from('salary_cycles')
            .select('cycle_start, cycle_end')
            .eq('user_id', this.user.id)
            .eq('cycle_start', cycleStartDate)
            .single();

        return data || null;
    }

    normalizeDate(d) {
        return new Date(d).toISOString().split('T')[0];
    }

    formatCurrency(n) {
        return '₹' + Number(n).toLocaleString('en-IN', {
            minimumFractionDigits: 2
        });
    }
}
