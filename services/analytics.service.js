export class AnalyticsService {
    constructor(user, ui, analyticsService) {
        this.user = user;
        this.ui = ui;
        this.categoryService = categoryService;
        this.analyticsService = analyticsService;
    }

    async init() {
        await this.loadCycleHistory();
        this.bindCycleChange();
    }

    async loadCycleHistory() {
        const selector = document.getElementById('cycle-history');
        if (!selector) return;

        const { data, error } = await supabaseClient
            .from('salary_cycles')
            .select('cycle_start, cycle_end')
            .eq('user_id', this.user.id)
            .order('cycle_start', { ascending: false });

        if (error || !data?.length) {
            selector.innerHTML = '<option>No cycles</option>';
            return;
        }

        this.cycles = data;
        selector.innerHTML = '';

        data.forEach((c, idx) => {
            const opt = document.createElement('option');
            opt.value = `${c.cycle_start}|${c.cycle_end}`;
            opt.textContent =
                idx === 0
                    ? `Current (${this.prettyDate(c.cycle_start)} → ${this.prettyDate(c.cycle_end)})`
                    : `${this.prettyDate(c.cycle_start)} → ${this.prettyDate(c.cycle_end)}`;
            selector.appendChild(opt);
        });

        const [start, end] = selector.value.split('|');
        this.loadAllForCycle(start, end);
    }

    bindCycleChange() {
        document.getElementById('cycle-history')
            ?.addEventListener('change', (e) => {
                const [start, end] = e.target.value.split('|');
                this.loadAllForCycle(start, end);
            });
    }

    loadAllForCycle(cycleStart, cycleEnd) {
        this.loadDashboardCycle(cycleStart);
        this.loadLineChart(cycleStart, cycleEnd);
        this.loadDonutChart(cycleStart, cycleEnd);
        this.transactionService.loadForCycle(cycleStart, cycleEnd);
    }

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

    async loadLineChart(start, end) {
        const { data } = await supabaseClient.rpc(
            'get_cycle_daily_expenses',
            { cycle_start: start, cycle_end: end }
        );

        this.analyticsData.dailyExpenses = data || [];

        this.destroyLineChart();
        if (!data?.length) return;

        this.lineChart = new Chart(
            document.getElementById('chart'),
            {
                type: 'line',
                data: {
                    labels: data.map(d => this.ui.prettyDate(d.day)),
                    datasets: [{
                        label: 'Daily Expenses',
                        data: data.map(d => d.total_expense),
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: { responsive: true }
            }
        );
    }

    async loadDonutChart(start, end) {
        const { data } = await supabaseClient.rpc(
            'get_cycle_expense_breakdown',
            { cycle_start: start, cycle_end: end }
        );

        this.analyticsData.categoryTotals = data || [];

        this.destroyDonutChart();
        if (!data?.length) return;

        this.donutChart = new Chart(
            document.getElementById('expense-donut-chart'),
            {
                type: 'doughnut',
                data: {
                    labels: data.map(d => d.category),
                    datasets: [{ data: data.map(d => d.total) }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } }
                }
            }
        );
    }

    destroyLineChart() {
        if (this.lineChart) this.lineChart.destroy();
        this.lineChart = null;
    }

    destroyDonutChart() {
        if (this.donutChart) this.donutChart.destroy();
        this.donutChart = null;
    }

    runLocalInsights() {
        const engine = new LocalAnalyticsEngine(this.analyticsData);
        const pace = engine.computeSpendPace();

        this.ui.renderInsights(pace);
    }

}
