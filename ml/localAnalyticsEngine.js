export class LocalAnalyticsEngine {
    constructor(analyticsData) {
        this.data = analyticsData;
    }

    computeSpendPace() {
        const daily = this.data.dailyExpenses;
        if (!daily.length) return null;

        const total = daily.reduce((s, d) => s + d.total_expense, 0);
        return {
            avgDailySpend: total / daily.length,
            daysObserved: daily.length,
            explainability: 'Average of daily expense totals'
        };
    }

    detectCategoryDrift() {
        // Placeholder for z-score / EWMA later
        return [];
    }
}
