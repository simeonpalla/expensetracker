// Handler-level integration tests for transactions.js.
// See login.test.js for why the Supabase stub goes through require.cache.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';

// Thenable query-builder stub: every method chains, awaiting resolves to
// state.result, and every call is recorded for assertions.
const state = { result: { data: [], error: null }, calls: [], user: { id: 'user-1' } };

function chain(table) {
    const c = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order']) {
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

const transactions = require('../../netlify/functions/transactions.js');

function event({ method = 'GET', body = null, token = 'valid-token', id } = {}) {
    return {
        httpMethod: method,
        body: body == null ? null : JSON.stringify(body),
        headers: token ? { cookie: `sb-access-token=${token}` } : {},
        queryStringParameters: id ? { id } : {}
    };
}

const validTx = {
    type: 'expense',
    amount: 249.5,
    category: 'Food',
    transaction_date: '2026-07-07',
    payment_to: 'Zomato',
    payment_source: 'upi',
    source_details: 'UBI'
};

beforeEach(() => {
    state.calls = [];
    state.result = { data: [], error: null };
});

describe('transactions auth', () => {
    it('401 without any credentials', async () => {
        const res = await transactions.handler(event({ token: null }));
        expect(res.statusCode).toBe(401);
    });

    it('401 with a bad token', async () => {
        const res = await transactions.handler(event({ token: 'expired' }));
        expect(res.statusCode).toBe(401);
    });

    it('still accepts a Bearer header (legacy clients mid-migration)', async () => {
        const res = await transactions.handler({
            httpMethod: 'GET',
            headers: { authorization: 'Bearer valid-token' },
            queryStringParameters: {}
        });
        expect(res.statusCode).toBe(200);
    });
});

describe('transactions GET', () => {
    it('scopes the query to the authenticated user', async () => {
        state.result = { data: [{ id: 1 }], error: null };
        const res = await transactions.handler(event({}));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([{ id: 1 }]);
        expect(state.calls).toContainEqual({
            table: 'transactions',
            method: 'eq',
            args: ['user_id', 'user-1']
        });
    });
});

describe('transactions POST', () => {
    it('accepts a valid transaction and forces user_id', async () => {
        const res = await transactions.handler(event({ method: 'POST', body: validTx }));
        expect(res.statusCode).toBe(200);
        const insert = state.calls.find(c => c.method === 'insert');
        expect(insert.args[0][0].user_id).toBe('user-1');
        expect(insert.args[0][0].amount).toBe(249.5);
    });

    it('strips mass-assigned fields (user_id, id, created_at, junk)', async () => {
        const res = await transactions.handler(
            event({
                method: 'POST',
                body: { ...validTx, user_id: 'attacker', id: 999, created_at: 'x', evil: true }
            })
        );
        expect(res.statusCode).toBe(200);
        const inserted = state.calls.find(c => c.method === 'insert').args[0][0];
        expect(inserted.user_id).toBe('user-1'); // not 'attacker'
        expect(inserted.id).toBeUndefined();
        expect(inserted.created_at).toBeUndefined();
        expect(inserted.evil).toBeUndefined();
    });

    it.each([
        ['negative amount', { ...validTx, amount: -5 }],
        ['zero amount', { ...validTx, amount: 0 }],
        ['amount not a number', { ...validTx, amount: 'lots' }],
        ['bad date', { ...validTx, transaction_date: '07/07/2026' }],
        ['impossible date', { ...validTx, transaction_date: '2026-02-30' }],
        ['bad type', { ...validTx, type: 'transfer' }],
        ['bad payment source', { ...validTx, payment_source: 'crypto' }],
        ['missing category', { ...validTx, category: '  ' }]
    ])('rejects %s with 400', async (_label, body) => {
        const res = await transactions.handler(event({ method: 'POST', body }));
        expect(res.statusCode).toBe(400);
        expect(state.calls.find(c => c.method === 'insert')).toBeUndefined();
    });
});

describe('transactions PUT/DELETE', () => {
    it('PUT requires an id and at least one valid field', async () => {
        expect((await transactions.handler(event({ method: 'PUT', body: { amount: 10 } }))).statusCode).toBe(
            400
        );
        expect(
            (await transactions.handler(event({ method: 'PUT', id: '7', body: { junk: 1 } }))).statusCode
        ).toBe(400);
    });

    it('PUT updates only whitelisted fields, scoped to id + user', async () => {
        const res = await transactions.handler(
            event({
                method: 'PUT',
                id: '7',
                body: { amount: 100, user_id: 'attacker' }
            })
        );
        expect(res.statusCode).toBe(200);
        const update = state.calls.find(c => c.method === 'update');
        expect(update.args[0]).toEqual({ amount: 100 });
        expect(state.calls).toContainEqual({ table: 'transactions', method: 'eq', args: ['id', '7'] });
        expect(state.calls).toContainEqual({
            table: 'transactions',
            method: 'eq',
            args: ['user_id', 'user-1']
        });
    });

    it('DELETE requires an id and scopes to the user', async () => {
        expect((await transactions.handler(event({ method: 'DELETE' }))).statusCode).toBe(400);
        const res = await transactions.handler(event({ method: 'DELETE', id: '7' }));
        expect(res.statusCode).toBe(200);
        expect(state.calls).toContainEqual({
            table: 'transactions',
            method: 'eq',
            args: ['user_id', 'user-1']
        });
    });

    it('database errors surface as a generic 500', async () => {
        state.result = { data: null, error: new Error('secret pg detail') };
        const res = await transactions.handler(event({}));
        expect(res.statusCode).toBe(500);
        expect(res.body).not.toContain('secret pg detail');
    });
});
