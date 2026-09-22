// Handler-level integration tests for me.js.
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

const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
        createClient: () => ({ auth: { getUser } })
    }
};

const me = require('../../netlify/functions/me.js');

function event({ method = 'GET', token = 'valid-token' } = {}) {
    return {
        httpMethod: method,
        headers: token ? { cookie: `sb-access-token=${token}` } : {},
        queryStringParameters: {}
    };
}

describe('me function', () => {
    it('rejects non-GET', async () => {
        const res = await me.handler(event({ method: 'POST' }));
        expect(res.statusCode).toBe(405);
    });

    it('401 without any credentials', async () => {
        const res = await me.handler(event({ token: null }));
        expect(res.statusCode).toBe(401);
    });

    it('401 with a bad token', async () => {
        const res = await me.handler(event({ token: 'expired' }));
        expect(res.statusCode).toBe(401);
    });

    it('returns the user for a valid session, nothing else', async () => {
        const res = await me.handler(event({}));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ user: { id: 'user-1', email: 'a@b.co' } });
    });
});
