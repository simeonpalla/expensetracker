// Handler-level integration tests for refresh.js.
// See login.test.js for why the Supabase stub goes through require.cache.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';

const refreshSession = vi.fn();

const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
        createClient: () => ({ auth: { refreshSession } })
    }
};

const refresh = require('../../netlify/functions/refresh.js');

let ipCounter = 0;
function event({ method = 'POST', token, ip } = {}) {
    return {
        httpMethod: method,
        headers: {
            ...(token ? { cookie: `sb-refresh-token=${token}` } : {}),
            'x-nf-client-connection-ip': ip || `10.0.1.${++ipCounter}`
        },
        queryStringParameters: {}
    };
}

beforeEach(() => refreshSession.mockReset());

describe('refresh function', () => {
    it('rejects non-POST', async () => {
        const res = await refresh.handler(event({ method: 'GET' }));
        expect(res.statusCode).toBe(405);
    });

    it('401 without a refresh-token cookie, never calls Supabase', async () => {
        const res = await refresh.handler(event({ token: null }));
        expect(res.statusCode).toBe(401);
        expect(refreshSession).not.toHaveBeenCalled();
    });

    it('expired/invalid refresh token: 401 and clears cookies', async () => {
        refreshSession.mockResolvedValue({ data: {}, error: { message: 'expired' } });
        const res = await refresh.handler(event({ token: 'stale' }));
        expect(res.statusCode).toBe(401);
        expect(res.multiValueHeaders['Set-Cookie'].every(c => c.includes('Max-Age=0'))).toBe(true);
    });

    it('success: rotates cookies, session never in the body', async () => {
        refreshSession.mockResolvedValue({
            data: {
                user: { id: 'u1', email: 'a@b.co' },
                session: { access_token: 'NEWACCESS', refresh_token: 'NEWREFRESH', expires_in: 3600 }
            },
            error: null
        });
        const res = await refresh.handler(event({ token: 'valid-refresh' }));
        expect(res.statusCode).toBe(200);
        const cookies = res.multiValueHeaders['Set-Cookie'];
        expect(cookies.some(c => c.includes('sb-access-token=NEWACCESS'))).toBe(true);
        expect(res.body).not.toContain('NEWACCESS');
        expect(JSON.parse(res.body).user).toEqual({ id: 'u1', email: 'a@b.co' });
    });

    it('rate limits after 30 attempts from one IP', async () => {
        refreshSession.mockResolvedValue({ data: {}, error: { message: 'expired' } });
        const ip = '203.0.113.50';
        for (let i = 0; i < 30; i++) {
            const res = await refresh.handler(event({ token: 'x', ip }));
            expect(res.statusCode).toBe(401);
        }
        const res31 = await refresh.handler(event({ token: 'x', ip }));
        expect(res31.statusCode).toBe(429);
        expect(refreshSession).toHaveBeenCalledTimes(30);
    });
});
