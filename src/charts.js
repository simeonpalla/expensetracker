// charts.js — lazy Chart.js loader. The chart library (~200 KB) is split
// into its own bundle chunk by the dynamic import and only downloaded the
// first time a chart actually renders.

let chartPromise = null;

export function loadChart() {
    if (!chartPromise) {
        chartPromise = import('chart.js/auto').then(m => m.default);
    }
    return chartPromise;
}
