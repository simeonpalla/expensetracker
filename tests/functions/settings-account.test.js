// Handler tests for settings.js, onboarding.js, account.js,
// forgot-password.js and reset-password.js.
// See login.test.js for why the Supabase stub goes through require.cache.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';

const state = { results: {}, calls: [], rpcResult: { error: null }, user: { id: 'user-1', email: 'a@b.co' } };

function chain(table) {
    const c = {};
    for (const m of ['select', 'insert', 'upsert', 'eq', 'maybeSingle']) {
        c[m] = (...args) => {
            state.calls.push({ table, method: m, args });
            return c;
        };
    }
    c.then = (resolve, reject) =>
        Promise.resolve(state.results[table] || { data: [], error: null }).then(resolve, reject);
    return c;
}

const getUser = vi.fn(async token =>
    token === 'valid-token'
        ? { data: { user: state.user }, error: null }
        : { data: { user: null }, error: { message: 'bad token' } }
);
const resetPasswordForEmail = vi.fn(async () => ({ error: null }));
const rpc = vi.fn(async name => {
    state.calls.push({ method: 'rpc', args: [name] });
    return state.rpcResult;
});

const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
        createClient: () => ({
            auth: { getUser, resetPasswordForEmail },
            from: table => chain(table),
            rpc
        })
    }
};

const settings = require('../../netlify/functions/settings.js');
const onboarding = require('../../netlify/functions/onboarding.js');
const account = require('../../netlify/functions/account.js');
const forgot = require('../../netlify/functions/forgot-password.js');
const reset = require('../../netlify/functions/reset-password.js');

function event({ method = 'GET', body = null, token = 'valid-token', ip = '1.1.1.1' } = {}) {
    return {
        httpMethod: method,
        body: body == null ? null : JSON.stringify(body),
        headers: {
            ...(token ? { cookie: `sb-access-token=${token}` } : {}),
            'x-nf-client-connection-ip': ip
        },
        queryStringParameters: {}
    };
}

beforeEach(() => {
    state.calls = [];
    state.results = {};
    state.rpcResult = { error: null };
    resetPasswordForEmail.mockClear();
    rpc.mockClear();
});

describe('settings', () => {
    it('401 when signed out', async () => {
        expect((await settings.handler(event({ token: null }))).statusCode).toBe(401);
    });

    it('GET returns defaults with exists:false when there is no row', async () => {
        state.results.user_settings = { data: null, error: null };
        const res = await settings.handler(event());
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({
            exists: false,
            salary_account: 'UBI',
            giving_floor_pct: 5
        });
    });

    it('PUT upserts only whitelisted, validated fields and forces user_id', async () => {
        const res = await settings.handler(
            event({
                method: 'PUT',
                body: {
                    salary_account: 'HDFC',
                    budget_limits: { Food: 5000 },
                    giving_floor_pct: 7.5,
                    user_id: 'attacker',
                    onboarded_at: 'x'
                }
            })
        );
        expect(res.statusCode).toBe(200);
        const upsert = state.calls.find(c => c.method === 'upsert');
        expect(upsert.args[0]).toMatchObject({
            user_id: 'user-1',
            salary_account: 'HDFC',
            budget_limits: { Food: 5000 },
            giving_floor_pct: 7.5
        });
        expect(upsert.args[0].onboarded_at).toBeUndefined();
    });

    it('PUT rejects bad values', async () => {
        for (const body of [
            { giving_floor_pct: 150 },
            { budget_limits: { Food: -1 } },
            { budget_limits: [] },
            { salary_account: '' },
            {}
        ]) {
            expect((await settings.handler(event({ method: 'PUT', body }))).statusCode).toBe(400);
        }
    });
});

describe('onboarding', () => {
    it('seeds defaults only when the user has no categories', async () => {
        state.results.categories = { data: null, error: null, count: 0 };
        state.results.payment_accounts = { data: null, error: null };
        state.results.user_settings = { data: null, error: null };
        const res = await onboarding.handler(event({ method: 'POST' }));
        expect(JSON.parse(res.body)).toEqual({ ok: true, seeded: true });
        const inserted = state.calls.find(c => c.table === 'categories' && c.method === 'insert');
        expect(inserted.args[0].every(r => r.user_id === 'user-1')).toBe(true);
        expect(inserted.args[0].length).toBeGreaterThan(5);
    });

    it('never touches an existing user’s categories', async () => {
        state.results.categories = { data: null, error: null, count: 4 };
        state.results.user_settings = { data: null, error: null };
        const res = await onboarding.handler(event({ method: 'POST' }));
        expect(JSON.parse(res.body)).toEqual({ ok: true, seeded: false });
        expect(state.calls.some(c => c.table === 'categories' && c.method === 'insert')).toBe(false);
    });
});

describe('account', () => {
    it('GET exports only the caller’s data as an attachment', async () => {
        state.results.transactions = { data: [{ id: 1 }], error: null };
        state.results.categories = { data: [{ id: 2 }], error: null };
        state.results.payment_accounts = { data: [], error: null };
        state.results.user_settings = { data: { salary_account: 'UBI' }, error: null };
        const res = await account.handler(event());
        expect(res.statusCode).toBe(200);
        expect(res.headers['Content-Disposition']).toContain('attachment');
        const body = JSON.parse(res.body);
        expect(body.transactions).toEqual([{ id: 1 }]);
        expect(body.account).toEqual({ id: 'user-1', email: 'a@b.co' });
        expect(state.calls.filter(c => c.method === 'eq').every(c => c.args[1] === 'user-1')).toBe(true);
    });

    it('DELETE requires the DELETE confirmation', async () => {
        const res = await account.handler(event({ method: 'DELETE', body: { confirm: 'yes' } }));
        expect(res.statusCode).toBe(400);
        expect(rpc).not.toHaveBeenCalled();
    });

    it('DELETE erases via the SQL function and clears the session cookies', async () => {
        const res = await account.handler(event({ method: 'DELETE', body: { confirm: 'DELETE' } }));
        expect(res.statusCode).toBe(200);
        expect(rpc).toHaveBeenCalledWith('delete_my_account');
        expect(res.multiValueHeaders['Set-Cookie'].every(c => c.includes('Max-Age=0'))).toBe(true);
    });

    it('401 when signed out', async () => {
        expect((await account.handler(event({ method: 'DELETE', token: null, body: {} }))).statusCode).toBe(
            401
        );
    });
});

describe('forgot-password', () => {
    it('answers 200 and sends a reset email', async () => {
        const res = await forgot.handler(event({ method: 'POST', body: { email: 'a@b.co' }, ip: '2.2.2.2' }));
        expect(res.statusCode).toBe(200);
        expect(resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', undefined);
    });

    it('still answers 200 when Supabase errors (no account enumeration)', async () => {
        resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'no such user' } });
        const res = await forgot.handler(event({ method: 'POST', body: { email: 'x@y.co' }, ip: '3.3.3.3' }));
        expect(res.statusCode).toBe(200);
    });

    it('rejects bad emails and rate limits the 4th attempt', async () => {
        expect(
            (await forgot.handler(event({ method: 'POST', body: { email: 'nope' }, ip: '4.4.4.4' })))
                .statusCode
        ).toBe(400);
        for (let i = 0; i < 2; i++) {
            await forgot.handler(event({ method: 'POST', body: { email: 'a@b.co' }, ip: '5.5.5.5' }));
        }
        await forgot.handler(event({ method: 'POST', body: { email: 'a@b.co' }, ip: '5.5.5.5' }));
        expect(
            (await forgot.handler(event({ method: 'POST', body: { email: 'a@b.co' }, ip: '5.5.5.5' })))
                .statusCode
        ).toBe(429);
    });
});

describe('reset-password', () => {
    const token = 'x'.repeat(40);

    it('sets the new password with the recovery token', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const res = await reset.handler(
            event({
                method: 'POST',
                body: { access_token: token, password: 'new-password-1' },
                ip: '6.6.6.6'
            })
        );
        expect(res.statusCode).toBe(200);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://test.supabase.co/auth/v1/user');
        expect(init.method).toBe('PUT');
        expect(init.headers.Authorization).toBe(`Bearer ${token}`);
        expect(JSON.parse(init.body)).toEqual({ password: 'new-password-1' });
        vi.unstubAllGlobals();
    });

    it('returns a generic 400 for an expired token', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: false, status: 401 }))
        );
        const res = await reset.handler(
            event({
                method: 'POST',
                body: { access_token: token, password: 'new-password-1' },
                ip: '7.7.7.7'
            })
        );
        expect(res.statusCode).toBe(400);
        vi.unstubAllGlobals();
    });

    it('validates password length and token shape before calling Supabase', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect(
            (
                await reset.handler(
                    event({ method: 'POST', body: { access_token: token, password: 'short' }, ip: '8.8.8.8' })
                )
            ).statusCode
        ).toBe(400);
        expect(
            (
                await reset.handler(
                    event({
                        method: 'POST',
                        body: { access_token: 'x', password: 'long-enough-1' },
                        ip: '8.8.8.8'
                    })
                )
            ).statusCode
        ).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});
