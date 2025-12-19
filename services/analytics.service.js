// services/analytics.service.js

export class AnalyticsService {
    constructor(user, ui) {
        this.user = user;
        this.ui = ui;

        this.currentCycle = null;
    }

    /* ----------------------------------
       INIT (called once after login)
    ---------------------------------- */
    async init() {
        await this.loadCycleHistory();
        console.info('[Analytics] Initialized');
    }

    /* ----------------------------------
       SALARY CYCLE HISTORY
    ---------------------------------- */
    async loadCycleHistory() {
        const selector = document.getElementById('cycle-history');
        if (!selector) return;

        try {
            const { data, error } = await supabaseClient
                .from('salary_cycles')
                .select('cycle_start, cycle_end')
                .eq('user_id', this.user.id)
                .order('cycle_start', { ascending: false });

            if (error) throw error;

            if (!data || data.length === 0) {
                selector.innerHTML =
                    '<option>No salary cycles found</option>';

                this.ui.showNotification(
                    'Add a salary transaction to start analytics',
                    'warning'
                );
                return;
            }

            selector.innerHTML = '';

            data.forEach((cycle, index) => {
                const startLabel = this.prettyDate(cycle.cycle_start);
                const endLabel = this.prettyDate(cycle.cycle_end);

                const option = document.createElement('option');
                option.value = cycle.cycle_start;
                option.textContent =
                    index === 0
                        ? `Current (${startLabel} → ${endLabel})`
                        : `${startLabel} → ${endLabel}`;

                selector.appendChild(option);
            });

            // load latest cycle immediately
            this.currentCycle = data[0];
            await this.loadDashboardCycle(data[0].cycle_start);

        } catch (err) {
            console.error('[Analytics] Failed to load salary cycles', err);
            this.ui.showNotification(
                'Failed to load salary cycles',
                'error'
            );
        }
    }

    /* ----------------------------------
       DASHBOARD AGGREGATES
    ---------------------------------- */
    async loadDashboardCycle(cycleStart) {
        try {
            const { data, error } = await supabaseClient
                .from('cycle_aggregates')
                .select(`
                    cycle_start,
                    cycle_end,
                    income,
                    expense
                `)
                .eq('user_id', this.user.id)
                .eq('cycle_start', cycleStart)
                .single();

            if (error || !data) {
                this.ui.showNotification(
                    'No data available for this cycle',
                    'warning'
                );
                return;
            }

            this.currentCycle = data;

            const balance = Number(data.income) - Number(data.expense);

            document.getElementById('total-income').textContent =
                this.formatCurrency(data.income);

            document.getElementById('total-expenses').textContent =
                this.formatCurrency(data.expense);

            document.getElementById('net-balance').textContent =
                this.formatCurrency(balance);

        } catch (err) {
            console.error('[Analytics] Dashboard update failed', err);
            this.ui.showNotification(
                'Dashboard failed to update',
                'error'
            );
        }
    }

    /* ----------------------------------
       DAILY EXPENSE SERIES (FOR ML)
    ---------------------------------- */
    async loadDailyExpenses(cycleStart, cycleEnd) {
        try {
            const { data, error } = await supabaseClient.rpc(
                'get_cycle_daily_expenses',
                {
                    cycle_start: cycleStart,
                    cycle_end: cycleEnd
                }
            );

            if (error) throw error;
            return data || [];

        } catch (err) {
            console.warn(
                '[Analytics] Daily expenses unavailable',
                err
            );
            return [];
        }
    }

    /* ----------------------------------
       LOCAL AI / ANALYTICS (PLACEHOLDER)
    ---------------------------------- */
    async runLocalInsights() {
        try {
            const { data, error } = await supabaseClient
                .from('transactions')
                .select(`
                    amount,
                    type,
                    category,
                    transaction_date,
                    payment_to
                `)
                .eq('user_id', this.user.id);

            if (error) throw error;

            if (!data || data.length < 5) {
                this.ui.showNotification(
                    'Not enough data for insights',
                    'warning'
                );
                return;
            }

            const totalExpense = data
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + Number(t.amount), 0);

            this.ui.showNotification(
                `Total tracked expense: ${this.formatCurrency(totalExpense)}`
            );

        } catch (err) {
            console.error('[Analytics] Insight failed', err);
            this.ui.showNotification(
                'Analytics failed to load',
                'error'
            );
        }
    }

    /* ----------------------------------
       HELPERS
    ---------------------------------- */
    formatCurrency(value) {
        return '₹' + Number(value).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    prettyDate(dateStr) {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short'
        });
    }
}
