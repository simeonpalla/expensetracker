import { describe, it, expect } from 'vitest';
import dates from '../../src/engine/dates.js';

describe('dates.toDateStr / todayStr', () => {
    it('uses the LOCAL calendar day, not UTC', () => {
        // 00:30 local on March 2nd. In UTC+5:30 (IST) the UTC clock still says
        // March 1st 19:00 — the old toISOString() code returned "yesterday".
        const localMidnightish = new Date(2026, 2, 2, 0, 30, 0);
        expect(dates.toDateStr(localMidnightish)).toBe('2026-03-02');
        expect(dates.todayStr(localMidnightish)).toBe('2026-03-02');
    });

    it('pads months and days', () => {
        expect(dates.toDateStr(new Date(2026, 0, 5))).toBe('2026-01-05');
    });
});

describe('dates.diffDays / addDays', () => {
    it('computes whole-day differences', () => {
        expect(dates.diffDays('2026-07-01', '2026-07-07')).toBe(6);
        expect(dates.diffDays('2026-07-07', '2026-07-01')).toBe(-6);
        expect(dates.diffDays('2026-07-07', '2026-07-07')).toBe(0);
    });

    it('crosses month and year boundaries', () => {
        expect(dates.diffDays('2025-12-31', '2026-01-01')).toBe(1);
        expect(dates.addDays('2026-01-31', 1)).toBe('2026-02-01');
        expect(dates.addDays('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('handles leap years', () => {
        expect(dates.addDays('2028-02-28', 1)).toBe('2028-02-29');
        expect(dates.diffDays('2028-02-28', '2028-03-01')).toBe(2);
    });
});

describe('dates.eachDay', () => {
    it('returns the inclusive range', () => {
        expect(dates.eachDay('2026-06-29', '2026-07-02')).toEqual([
            '2026-06-29',
            '2026-06-30',
            '2026-07-01',
            '2026-07-02'
        ]);
    });

    it('single-day range', () => {
        expect(dates.eachDay('2026-07-07', '2026-07-07')).toEqual(['2026-07-07']);
    });
});
