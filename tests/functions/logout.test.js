// Handler-level integration tests for logout.js.
// See login.test.js for why the Supabase stub goes through require.cache.
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';

const getUser = vi.fn(async token =>
    token === 'valid-token'
        ? { data: { user: { id: 'user-1', email: 'a@b.co' } }, error: null }
        : { data: { user: null }, error: { message: 'bad token' } }
);
const signOut = vi.fn().mockResolvedValue({ error: null });

const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
        createClient: () => ({ auth: { getUser, signOut } })
    }
};

const logout = require('../../netlify/functions/logout.js');

function event({ method = 'POST', token = 'valid-token' } = {}) {
    return {
        httpMethod: method,
        headers: token ? { cookie: `sb-access-token=${token}` } : {},
        queryStringParameters: {}
    };
}

describe('logout function', () => {
    it('rejects non-POST', async () => {
        const res = await logout.handler(event({ method: 'GET' }));
        expect(res.statusCode).toBe(405);
    });

    it('clears cookies and revokes the session when signed in', async () => {
        const res = await logout.handler(event({}));
        expect(res.statusCode).toBe(200);
        expect(signOut).toHaveBeenCalledOnce();
        const cookies = res.multiValueHeaders['Set-Cookie'];
        expect(cookies.every(c => c.includes('Max-Age=0'))).toBe(true);
    });

    it('still returns 200 and clears cookies with no session (idempotent)', async () => {
        const res = await logout.handler(event({ token: null }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true });
    });

    it('still clears cookies even if revocation throws', async () => {
        signOut.mockRejectedValueOnce(new Error('network blip'));
        const res = await logout.handler(event({}));
        expect(res.statusCode).toBe(200);
        expect(res.multiValueHeaders['Set-Cookie']).toHaveLength(2);
    });
});
