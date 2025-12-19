// services/analytics.service.js

export class AnalyticsService {
    constructor(user, ui) {
        this.user = user;
        this.ui = ui;
        this.currentCycle = null;
        this.lineChart = null;
        this.donutChart = null;
    }

    /* ---------------- INIT ---------------- */
    async init(transactionsService) {
        this.transactionsService = transactionsService;
        await this.loadCycleHistory();
        console.info('[Analytics] Initialized');
    }

    /* -------- SALARY CYCLE HISTORY -------- */
    async loadCycleHistory() {
        const selector = document.getElementById('cycle-history');
        if (!selector) return;

        const { data, error } = await supabaseClient
            .from('salary_cycles')
            .select('cycle_start, cycle_end')
            .eq('user_id', this.user.id)
            .order('cycle_start', { ascending: false });

        if (error || !data?.length) {
            selector.innerHTML = '<option>No salary cycles</option>';
            this.ui.showNotification('Add a salary transaction first', 'warning');
            return;
        }

        selector.innerHTML = '';

        data.forEach((c, i) => {
            const opt = document.createElement('option');
            opt.value = c.cycle_start;
            opt.textContent =
                i === 0
                    ? `Current (${this.prettyDate(c.cycle_start)} → ${this.prettyDate(c.cycle_end)})`
                    : `${this.prettyDate(c.cycle_start)} → ${this.prettyDate(c.cycle_end)}`;
            selector.appendChild(opt);
        });

        // ✅ INITIAL LOAD (THIS WAS MISSING)
        await this.loadFullCycle(data[0].cycle_start);
    }

    /* -------- SINGLE SOURCE OF TRUTH -------- */
    async loadFullCycle(cycleStart) {
        if (!cycleStart) return;

        console.info('[Analytics] Loading full cycle:', cycleStart);

        await this.loadDashboardCycle(cycleStart);
        await this.loadLineChart(cycleStart);
        await this.loadDonutChart(cycleStart);

        if (this.transactionsService) {
            await this.transactionsService.loadByCycle(cycleStart);
        }
    }

    /* -------- DASHBOARD TOTALS -------- */
    async loadDashboardCycle(cycleStart) {
        const { data } = await supabaseClient
            .from('cycle_aggregates')
            .select('income, expense')
            .eq('user_id', this.user.id)
            .eq('cycle_start', cycleStart)
            .single();

        if (!data) return;

        document.getElementById('total-income').textContent =
            this.formatCurrency(data.income);

        document.getElementById('total-expenses').textContent =
            this.formatCurrency(data.expense);

        document.getElementById('net-balance').textContent =
            this.formatCurrency(data.income - data.expense);
    }

    /* -------- LINE CHART -------- */
    async loadLineChart(cycleStart) {
        const cycle = await this.getCycle(cycleStart);
        if (!cycle) return;

        const { data } = await supabaseClient.rpc(
            'get_cycle_daily_expenses',
            {
                cycle_start: cycle.cycle_start,
                cycle_end: cycle.cycle_end
            }
        );

        if (!data?.length) return;

        const labels = data.map(d =>
            new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        );
        const values = data.map(d => d.total_expense);

        if (this.lineChart) this.lineChart.destroy();

        this.lineChart = new Chart(
            document.getElementById('chart'),
            {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Daily Expenses',
                        data: values,
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            }
        );
    }

    /* -------- DONUT CHART -------- */
    async loadDonutChart(cycleStart) {
        const cycle = await this.getCycle(cycleStart);
        if (!cycle) return;

        const { data } = await supabaseClient.rpc(
            'get_cycle_expense_breakdown',
            {
                cycle_start: cycle.cycle_start,
                cycle_end: cycle.cycle_end
            }
        );

        if (!data?.length) return;

        if (this.donutChart) this.donutChart.destroy();

        this.donutChart = new Chart(
            document.getElementById('expense-donut-chart'),
            {
                type: 'doughnut',
                data: {
                    labels: data.map(d => d.category),
                    datasets: [{
                        data: data.map(d => d.total)
                    }]
                },
                options: { responsive: true }
            }
        );
    }

    /* -------- HELPERS -------- */
    async getCycle(cycleStart) {
        const { data } = await supabaseClient
            .from('salary_cycles')
            .select('cycle_start, cycle_end')
            .eq('user_id', this.user.id)
            .eq('cycle_start', cycleStart)
            .single();
        return data;
    }

    formatCurrency(v) {
        return '₹' + Number(v).toLocaleString('en-IN', {
            minimumFractionDigits: 2
        });
    }

    prettyDate(d) {
        return new Date(d).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short'
        });
    }
}
