import { describe, it, expect } from 'vitest';
import lib from '../../netlify/functions/_lib.js';

describe('_lib validators', () => {
    it('isDateStr accepts real dates only', () => {
        expect(lib.isDateStr('2026-07-07')).toBe(true);
        expect(lib.isDateStr('2026-02-30')).toBe(false); // not a real day
        expect(lib.isDateStr('2026-13-01')).toBe(false);
        expect(lib.isDateStr('07-07-2026')).toBe(false);
        expect(lib.isDateStr(20260707)).toBe(false);
        expect(lib.isDateStr('')).toBe(false);
    });

    it('cleanString trims and enforces max length', () => {
        expect(lib.cleanString('  hello  ', 10)).toBe('hello');
        expect(lib.cleanString('x'.repeat(11), 10)).toBe(null);
        expect(lib.cleanString('   ', 10)).toBe(null);
        expect(lib.cleanString(42, 10)).toBe(null);
    });

    it('isEmail sanity checks', () => {
        expect(lib.isEmail('a@b.co')).toBe(true);
        expect(lib.isEmail('not-an-email')).toBe(false);
        expect(lib.isEmail(`${'a'.repeat(255)}@b.co`)).toBe(false);
    });

    it('isIsoTimestamp', () => {
        expect(lib.isIsoTimestamp('2026-07-07T10:00:00.000Z')).toBe(true);
        expect(lib.isIsoTimestamp('garbage')).toBe(false);
        expect(lib.isIsoTimestamp('x'.repeat(50))).toBe(false);
    });
});

describe('_lib cookies', () => {
    it('parseCookies splits and decodes', () => {
        const event = { headers: { cookie: 'a=1; sb-access-token=tok%20en; b=2' } };
        expect(lib.parseCookies(event)['sb-access-token']).toBe('tok en');
        expect(lib.parseCookies({ headers: {} })).toEqual({});
    });

    it('sessionCookies sets HttpOnly/Secure/SameSite=Strict on both cookies', () => {
        const cookies = lib.sessionCookies({ access_token: 'A', refresh_token: 'R', expires_in: 3600 });
        expect(cookies).toHaveLength(2);
        cookies.forEach(c => {
            expect(c).toContain('HttpOnly');
            expect(c).toContain('Secure');
            expect(c).toContain('SameSite=Strict');
            expect(c).toContain('Path=/.netlify/functions/');
        });
        expect(cookies[0]).toContain(`${lib.ACCESS_COOKIE}=A`);
        expect(cookies[0]).toContain('Max-Age=3600');
        expect(cookies[1]).toContain(`${lib.REFRESH_COOKIE}=R`);
    });

    it('clearSessionCookies expires both cookies', () => {
        lib.clearSessionCookies().forEach(c => expect(c).toContain('Max-Age=0'));
    });

    it('getAccessToken prefers the cookie, falls back to Bearer header', () => {
        expect(lib.getAccessToken({ headers: { cookie: `${lib.ACCESS_COOKIE}=fromcookie` } })).toBe(
            'fromcookie'
        );
        expect(lib.getAccessToken({ headers: { authorization: 'Bearer fromheader' } })).toBe('fromheader');
        expect(
            lib.getAccessToken({
                headers: { cookie: `${lib.ACCESS_COOKIE}=fromcookie`, authorization: 'Bearer fromheader' }
            })
        ).toBe('fromcookie');
        expect(lib.getAccessToken({ headers: {} })).toBe(null);
    });
});

describe('_lib readJsonBody', () => {
    it('parses valid objects', () => {
        const r = lib.readJsonBody({ body: '{"a":1}' });
        expect(r.ok).toBe(true);
        expect(r.body).toEqual({ a: 1 });
    });

    it('rejects invalid JSON, arrays, and oversized payloads', () => {
        expect(lib.readJsonBody({ body: 'nope{' }).response.statusCode).toBe(400);
        expect(lib.readJsonBody({ body: '[1,2]' }).response.statusCode).toBe(400);
        expect(lib.readJsonBody({ body: '"str"' }).response.statusCode).toBe(400);
        const big = JSON.stringify({ x: 'y'.repeat(21 * 1024) });
        expect(lib.readJsonBody({ body: big }).response.statusCode).toBe(413);
    });

    it('empty body -> empty object', () => {
        expect(lib.readJsonBody({ body: '' }).body).toEqual({});
    });
});

describe('_lib rateLimit', () => {
    it('allows up to the limit then blocks within the window', () => {
        const key = `test-${Date.now()}`;
        for (let i = 0; i < 3; i++) expect(lib.rateLimit('t', key, 3, 60000)).toBe(true);
        expect(lib.rateLimit('t', key, 3, 60000)).toBe(false);
    });

    it('buckets are independent per key', () => {
        const a = `a-${Date.now()}`,
            b = `b-${Date.now()}`;
        expect(lib.rateLimit('t2', a, 1, 60000)).toBe(true);
        expect(lib.rateLimit('t2', a, 1, 60000)).toBe(false);
        expect(lib.rateLimit('t2', b, 1, 60000)).toBe(true);
    });
});
