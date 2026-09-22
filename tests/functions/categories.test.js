// Handler-level integration tests for categories.js.
// See login.test.js for why the Supabase stub goes through require.cache.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';

const state = { result: { data: [], error: null }, calls: [], user: { id: 'user-1' } };

function chain(table) {
    const c = {};
    for (const m of ['select', 'insert', 'eq', 'order']) {
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

const categories = require('../../netlify/functions/categories.js');

function event({ method = 'GET', body = null, token = 'valid-token' } = {}) {
    return {
        httpMethod: method,
        body: body == null ? null : JSON.stringify(body),
        headers: token ? { cookie: `sb-access-token=${token}` } : {},
        queryStringParameters: {}
    };
}

beforeEach(() => {
    state.calls = [];
    state.result = { data: [], error: null };
});

describe('categories auth', () => {
    it('401 without any credentials', async () => {
        const res = await categories.handler(event({ token: null }));
        expect(res.statusCode).toBe(401);
    });

    it('401 with a bad token', async () => {
        const res = await categories.handler(event({ token: 'expired' }));
        expect(res.statusCode).toBe(401);
    });
});

describe('categories GET', () => {
    it('scopes the query to the authenticated user', async () => {
        state.result = { data: [{ id: 1, name: 'Food', type: 'expense', icon: '🍔' }], error: null };
        const res = await categories.handler(event({}));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([{ id: 1, name: 'Food', type: 'expense', icon: '🍔' }]);
        expect(state.calls).toContainEqual({
            table: 'categories',
            method: 'eq',
            args: ['user_id', 'user-1']
        });
    });

    it('returns an empty array when there is no data', async () => {
        state.result = { data: null, error: null };
        const res = await categories.handler(event({}));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });
});

describe('categories POST', () => {
    it('accepts a valid category, forces user_id, and defaults the icon', async () => {
        const res = await categories.handler(
            event({ method: 'POST', body: { name: 'Food', type: 'expense' } })
        );
        expect(res.statusCode).toBe(200);
        const insert = state.calls.find(c => c.method === 'insert');
        expect(insert.args[0][0]).toEqual({ user_id: 'user-1', name: 'Food', type: 'expense', icon: '📁' });
    });

    it('accepts a custom icon and strips mass-assigned fields', async () => {
        const res = await categories.handler(
            event({
                method: 'POST',
                body: { name: 'Food', type: 'expense', icon: '🍔', user_id: 'attacker', id: 999 }
            })
        );
        expect(res.statusCode).toBe(200);
        const inserted = state.calls.find(c => c.method === 'insert').args[0][0];
        expect(inserted).toEqual({ user_id: 'user-1', name: 'Food', type: 'expense', icon: '🍔' });
    });

    it.each([
        ['missing name', { name: '  ', type: 'expense' }],
        ['name too long', { name: 'x'.repeat(41), type: 'expense' }],
        ['bad type', { name: 'Food', type: 'transfer' }]
    ])('rejects %s with 400', async (_label, body) => {
        const res = await categories.handler(event({ method: 'POST', body }));
        expect(res.statusCode).toBe(400);
        expect(state.calls.find(c => c.method === 'insert')).toBeUndefined();
    });
});

describe('categories method/error handling', () => {
    it('rejects unsupported methods with 405', async () => {
        const res = await categories.handler(event({ method: 'DELETE' }));
        expect(res.statusCode).toBe(405);
    });

    it('database errors surface as a generic 500', async () => {
        state.result = { data: null, error: new Error('secret pg detail') };
        const res = await categories.handler(event({}));
        expect(res.statusCode).toBe(500);
        expect(res.body).not.toContain('secret pg detail');
    });
});
