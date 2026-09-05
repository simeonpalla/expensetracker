// Handler-level integration tests for accounts.js.
// See login.test.js for why the Supabase stub goes through require.cache.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';

const state = { result: { data: [], error: null }, calls: [], user: { id: 'user-1' } };

function chain(table) {
    const c = {};
    for (const m of ['select', 'insert', 'delete', 'eq', 'order']) {
        c[m] = (...args) => {
            state.calls.push({ table, method: m, args });
            return c;
        };
    }
    c.then = (resolve, reject) => Promise.resolve(state.result).then(resolve, reject);
    return c;
}

const getUser = vi.fn(async token =>
    token === 'valid-token'
        ? { data: { user: state.user }, error: null }
        : { data: { user: null }, error: { message: 'bad token' } }
);

const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
        createClient: () => ({ auth: { getUser }, from: table => chain(table) })
    }
};

const accounts = require('../../netlify/functions/accounts.js');

function event({ method = 'GET', body = null, token = 'valid-token', id } = {}) {
    return {
        httpMethod: method,
        body: body == null ? null : JSON.stringify(body),
        headers: token ? { cookie: `sb-access-token=${token}` } : {},
        queryStringParameters: id ? { id } : {}
    };
}

beforeEach(() => {
    state.calls = [];
    state.result = { data: [], error: null };
});

describe('accounts auth', () => {
    it('401 without any credentials', async () => {
        const res = await accounts.handler(event({ token: null }));
        expect(res.statusCode).toBe(401);
    });
});

describe('accounts GET', () => {
    it('scopes the query to the authenticated user', async () => {
        state.result = { data: [{ id: 1, name: 'UBI', type: 'upi' }], error: null };
        const res = await accounts.handler(event({}));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([{ id: 1, name: 'UBI', type: 'upi' }]);
        expect(state.calls).toContainEqual({ table: 'payment_accounts', method: 'eq', args: ['user_id', 'user-1'] });
    });
});

describe('accounts POST', () => {
    it('accepts a valid account and forces user_id', async () => {
        const res = await accounts.handler(
            event({ method: 'POST', body: { name: 'RBL', type: 'credit-card' } })
        );
        expect(res.statusCode).toBe(200);
        const insert = state.calls.find(c => c.method === 'insert');
        expect(insert.args[0][0]).toEqual({ user_id: 'user-1', name: 'RBL', type: 'credit-card' });
    });

    it.each([
        ['missing name', { name: '  ', type: 'upi' }],
        ['bad type', { name: 'RBL', type: 'crypto' }]
    ])('rejects %s with 400', async (_label, body) => {
        const res = await accounts.handler(event({ method: 'POST', body }));
        expect(res.statusCode).toBe(400);
        expect(state.calls.find(c => c.method === 'insert')).toBeUndefined();
    });
});

describe('accounts DELETE', () => {
    it('requires an id and scopes to the user', async () => {
        expect((await accounts.handler(event({ method: 'DELETE' }))).statusCode).toBe(400);
        const res = await accounts.handler(event({ method: 'DELETE', id: '7' }));
        expect(res.statusCode).toBe(200);
        expect(state.calls).toContainEqual({ table: 'payment_accounts', method: 'eq', args: ['user_id', 'user-1'] });
    });
});
