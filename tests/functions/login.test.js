// Handler-level integration tests for login.js.
// The functions are CommonJS and load @supabase/supabase-js with native
// require(), which Vitest's vi.mock cannot intercept — so the stub is
// injected into Node's require cache before the handler is loaded.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';

const signInWithPassword = vi.fn();

const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
        createClient: () => ({ auth: { signInWithPassword } })
    }
};

const login = require('../../netlify/functions/login.js');

let ipCounter = 0;
function event({ method = 'POST', body = null, ip } = {}) {
    return {
        httpMethod: method,
        body: body == null ? null : JSON.stringify(body),
        headers: { 'x-nf-client-connection-ip': ip || `10.0.0.${++ipCounter}` },
        queryStringParameters: {}
    };
}

beforeEach(() => signInWithPassword.mockReset());

describe('login function', () => {
    it('rejects non-POST', async () => {
        const res = await login.handler(event({ method: 'GET' }));
        expect(res.statusCode).toBe(405);
    });

    it('rejects malformed JSON', async () => {
        const res = await login.handler({ ...event({}), body: 'not-json{' });
        expect(res.statusCode).toBe(400);
    });

    it('rejects invalid email shape without calling Supabase', async () => {
        const res = await login.handler(event({ body: { email: 'nope', password: 'x' } }));
        expect(res.statusCode).toBe(400);
        expect(signInWithPassword).not.toHaveBeenCalled();
    });

    it('wrong credentials: uniform 401, no cookies', async () => {
        signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } });
        const res = await login.handler(event({ body: { email: 'a@b.co', password: 'wrong-pass' } }));
        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body).error).toBe('Invalid email or password.');
        expect(res.multiValueHeaders).toBeUndefined();
        expect(signInWithPassword).toHaveBeenCalledOnce();
    });

    it('success: session goes into HttpOnly cookies, never the body', async () => {
        signInWithPassword.mockResolvedValue({
            data: {
                user: { id: 'u1', email: 'a@b.co' },
                session: { access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600 }
            },
            error: null
        });
        const res = await login.handler(event({ body: { email: 'a@b.co', password: 'right-pass' } }));

        expect(res.statusCode).toBe(200);
        const cookies = res.multiValueHeaders['Set-Cookie'];
        expect(cookies.some(c => c.includes('sb-access-token=ACCESS') && c.includes('HttpOnly'))).toBe(true);
        expect(cookies.some(c => c.includes('sb-refresh-token=REFRESH') && c.includes('HttpOnly'))).toBe(
            true
        );
        expect(res.body).not.toContain('ACCESS');
        expect(res.body).not.toContain('REFRESH');
        expect(JSON.parse(res.body).user).toEqual({ id: 'u1', email: 'a@b.co' });
    });

    it('rate limits the 6th attempt from one IP', async () => {
        signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'nope' } });
        const ip = '203.0.113.99';
        for (let i = 0; i < 5; i++) {
            const res = await login.handler(event({ body: { email: 'a@b.co', password: 'wrong-pass' }, ip }));
            expect(res.statusCode).toBe(401);
        }
        const res6 = await login.handler(event({ body: { email: 'a@b.co', password: 'wrong-pass' }, ip }));
        expect(res6.statusCode).toBe(429);
        expect(signInWithPassword).toHaveBeenCalledTimes(5); // 6th never reaches Supabase
    });
});
