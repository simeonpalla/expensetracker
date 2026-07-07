import { describe, it, expect } from 'vitest';
import cycles from '../../src/engine/cycles.js';

const salary = (date, amount = 50000) => ({
    type: 'income', category: 'Salary', transaction_date: date, amount
});
const expense = (date, amount, category = 'Food') => ({
    type: 'expense', category, transaction_date: date, amount
});

describe('cycles.salaryTransactions', () => {
    it('matches any category containing "salary", case-insensitive', () => {
        const txs = [
            { type: 'income', category: 'Monthly SALARY', transaction_date: '2026-06-01', amount: 1 },
            { type: 'income', category: 'Freelance', transaction_date: '2026-06-02', amount: 1 },
            { type: 'expense', category: 'Salary', transaction_date: '2026-06-03', amount: 1 } // expense: not a salary
        ];
        const result = cycles.salaryTransactions(txs);
        expect(result).toHaveLength(1);
        expect(result[0].transaction_date).toBe('2026-06-01');
    });
});

describe('cycles.deriveCycles', () => {
    it('falls back to calendar month-to-date when there is no salary at all', () => {
        const result = cycles.deriveCycles([expense('2026-07-03', 100)], '2026-07-07');
        expect(result).toEqual([
            { start: '2026-07-01', end: '2026-07-07', isCurrent: true, fallback: true }
        ]);
    });

    it('first cycle ever: one current cycle from salary date to today', () => {
        const result = cycles.deriveCycles([salary('2026-07-01')], '2026-07-07');
        expect(result).toEqual([{ start: '2026-07-01', end: '2026-07-07', isCurrent: true }]);
    });

    it('multiple salaries: newest first, past cycles end the day before the next salary', () => {
        const txs = [salary('2026-05-01'), salary('2026-06-01'), salary('2026-07-01')];
        const result = cycles.deriveCycles(txs, '2026-07-07');
        expect(result).toEqual([
            { start: '2026-07-01', end: '2026-07-07', isCurrent: true },
            { start: '2026-06-01', end: '2026-06-30', isCurrent: false },
            { start: '2026-05-01', end: '2026-05-31', isCurrent: false }
        ]);
    });

    it('handles empty data', () => {
        const result = cycles.deriveCycles([], '2026-07-07');
        expect(result[0].fallback).toBe(true);
    });
});

describe('cycles.expectedCycleLength', () => {
    it('defaults to 30 with fewer than two salaries', () => {
        expect(cycles.expectedCycleLength([])).toBe(30);
        expect(cycles.expectedCycleLength([salary('2026-07-01')])).toBe(30);
    });

    it('uses the median salary gap (NOT hard-coded 30)', () => {
        // gaps: 31, 28, 33 -> median 31
        const txs = [
            salary('2026-03-01'), salary('2026-04-01'),
            salary('2026-04-29'), salary('2026-06-01')
        ];
        expect(cycles.expectedCycleLength(txs)).toBe(31);
    });

    it('clamps absurd gaps to the 20–45 payroll range', () => {
        expect(cycles.expectedCycleLength([salary('2026-01-01'), salary('2026-06-01')])).toBe(45);
        expect(cycles.expectedCycleLength([salary('2026-06-01'), salary('2026-06-08')])).toBe(20);
    });
});

describe('cycles.dayOfCycle', () => {
    it('salary day is day 1', () => {
        expect(cycles.dayOfCycle('2026-07-01', '2026-07-01')).toBe(1);
        expect(cycles.dayOfCycle('2026-07-01', '2026-07-07')).toBe(7);
    });
});

describe('cycles.historicalSpendByCycleDay', () => {
    it('maps expenses to day-of-cycle across past cycles and skips pre-salary expenses', () => {
        const txs = [
            expense('2026-04-15', 999),          // before any salary: skipped
            salary('2026-05-01'),
            expense('2026-05-01', 100),          // day 1
            expense('2026-05-03', 200),          // day 3
            salary('2026-06-01'),
            expense('2026-06-03', 400),          // day 3 of the next cycle
            expense('2026-06-20', 50)
        ];
        const map = cycles.historicalSpendByCycleDay(txs, '2026-07-01');
        expect(map[1]).toEqual([100]);
        expect(map[3]).toEqual([200, 400]);
        expect(map[20]).toEqual([50]);
        expect(Object.values(map).flat()).not.toContain(999);
    });

    it('only counts expenses strictly before the given date', () => {
        const txs = [salary('2026-06-01'), expense('2026-06-05', 100), expense('2026-07-02', 500)];
        const map = cycles.historicalSpendByCycleDay(txs, '2026-07-01');
        expect(Object.values(map).flat()).toEqual([100]);
    });
});

describe('cycles.noSpendStreak', () => {
    it('empty cycle: every day counts', () => {
        const s = cycles.noSpendStreak([], '2026-07-01', '2026-07-07');
        expect(s).toEqual({ currentStreak: 7, bestStreak: 7 });
    });

    it('expense today breaks the current streak', () => {
        const s = cycles.noSpendStreak([expense('2026-07-07', 10)], '2026-07-01', '2026-07-07');
        expect(s.currentStreak).toBe(0);
        expect(s.bestStreak).toBe(6);
    });

    it('expense mid-cycle: current streak counts back from today', () => {
        const s = cycles.noSpendStreak([expense('2026-07-04', 10)], '2026-07-01', '2026-07-07');
        expect(s.currentStreak).toBe(3); // 5th, 6th, 7th
        expect(s.bestStreak).toBe(3);
    });

    it('income never breaks a streak', () => {
        const s = cycles.noSpendStreak([salary('2026-07-03')], '2026-07-01', '2026-07-07');
        expect(s.currentStreak).toBe(7);
    });

    it('degenerate input (start after today) is safe', () => {
        const s = cycles.noSpendStreak([], '2026-07-10', '2026-07-07');
        expect(s).toEqual({ currentStreak: 0, bestStreak: 0 });
    });
});
