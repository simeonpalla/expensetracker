// Handler-level integration tests for signup.js.
// See login.test.js for why the Supabase stub goes through require.cache.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';

const signUp = vi.fn();

const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
        createClient: () => ({ auth: { signUp } })
    }
};

const signup = require('../../netlify/functions/signup.js');

let ipCounter = 0;
function event({ method = 'POST', body = null, ip } = {}) {
    return {
        httpMethod: method,
        body: body == null ? null : JSON.stringify(body),
        headers: { 'x-nf-client-connection-ip': ip || `10.0.2.${++ipCounter}` },
        queryStringParameters: {}
    };
}

beforeEach(() => signUp.mockReset());

describe('signup function', () => {
    it('rejects non-POST', async () => {
        const res = await signup.handler(event({ method: 'GET' }));
        expect(res.statusCode).toBe(405);
    });

    it('rejects invalid email shape without calling Supabase', async () => {
        const res = await signup.handler(event({ body: { email: 'nope', password: 'longenough1' } }));
        expect(res.statusCode).toBe(400);
        expect(signUp).not.toHaveBeenCalled();
    });

    it.each([
        ['too short', 'short1'],
        ['too long', 'x'.repeat(129)]
    ])('rejects a password that is %s with 400', async (_label, password) => {
        const res = await signup.handler(event({ body: { email: 'a@b.co', password } }));
        expect(res.statusCode).toBe(400);
        expect(signUp).not.toHaveBeenCalled();
    });

    it('Supabase error: generic message, never leaks whether the email exists', async () => {
        signUp.mockResolvedValue({ data: {}, error: { message: 'User already registered' } });
        const res = await signup.handler(event({ body: { email: 'a@b.co', password: 'longenough1' } }));
        expect(res.statusCode).toBe(400);
        expect(res.body).not.toContain('already registered');
    });

    it('immediate session (email confirmation off): cookies set, never in body', async () => {
        signUp.mockResolvedValue({
            data: {
                user: { id: 'u1', email: 'a@b.co' },
                session: { access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600 }
            },
            error: null
        });
        const res = await signup.handler(event({ body: { email: 'a@b.co', password: 'longenough1' } }));
        expect(res.statusCode).toBe(200);
        expect(res.multiValueHeaders['Set-Cookie'].some(c => c.includes('sb-access-token=ACCESS'))).toBe(
            true
        );
        expect(res.body).not.toContain('ACCESS');
    });

    it('email confirmation required: no session, no cookies', async () => {
        signUp.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
        const res = await signup.handler(event({ body: { email: 'a@b.co', password: 'longenough1' } }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ needsConfirmation: true });
        expect(res.multiValueHeaders).toBeUndefined();
    });

    it('rate limits the 4th signup attempt from one IP', async () => {
        signUp.mockResolvedValue({ data: {}, error: { message: 'nope' } });
        const ip = '203.0.113.77';
        for (let i = 0; i < 3; i++) {
            const res = await signup.handler(
                event({ body: { email: 'a@b.co', password: 'longenough1' }, ip })
            );
            expect(res.statusCode).toBe(400);
        }
        const res4 = await signup.handler(event({ body: { email: 'a@b.co', password: 'longenough1' }, ip }));
        expect(res4.statusCode).toBe(429);
        expect(signUp).toHaveBeenCalledTimes(3);
    });
});
