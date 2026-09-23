// settings.js
// GET -> the caller's settings (defaults when no row exists yet)
// PUT -> partial update of whitelisted fields (upsert)
//
// Replaces the browser-localStorage copies of budgets, the giving floor
// and the salary account, so they follow the account across devices.
// Anon key + caller JWT: RLS is the enforcement boundary.

const { json, requireUser, readJsonBody, cleanString, withLogging } = require('./_lib');
const { getSettings, upsertSettings } = require('./lib/settings-repo');

const DEFAULTS = {
    salary_account: 'UBI',
    budget_limits: {},
    giving_floor_pct: 5,
    giving_floor_category: '',
    onboarded_at: null
};

function shape(row) {
    if (!row) return { exists: false, ...DEFAULTS };
    return {
        exists: true,
        salary_account: row.salary_account,
        budget_limits: row.budget_limits || {},
        giving_floor_pct: Number(row.giving_floor_pct),
        giving_floor_category: row.giving_floor_category || '',
        onboarded_at: row.onboarded_at || null
    };
}

function validateBudgetLimits(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const entries = Object.entries(v);
    if (entries.length > 100) return null;
    const out = {};
    for (const [k, val] of entries) {
        const name = cleanString(k, 40);
        const n = Number(val);
        if (!name || !Number.isFinite(n) || n <= 0 || n > 1e9) return null;
        out[name] = n;
    }
    return out;
}

const handler = async function (event) {
    try {
        const auth = await requireUser(event);
        if (!auth) return json(401, { error: 'Not signed in' });
        const { user, supabase } = auth;

        if (event.httpMethod === 'GET') {
            const { data, error } = await getSettings(supabase, user.id);
            if (error) throw error;
            return json(200, shape(data));
        }

        if (event.httpMethod === 'PUT') {
            const parsed = readJsonBody(event);
            if (!parsed.ok) return parsed.response;
            const body = parsed.body;
            const patch = {};

            if ('salary_account' in body) {
                const v = cleanString(body.salary_account, 60);
                if (!v) return json(400, { error: 'salary_account must be 1-60 characters' });
                patch.salary_account = v;
            }
            if ('budget_limits' in body) {
                const v = validateBudgetLimits(body.budget_limits);
                if (!v) {
                    return json(400, { error: 'budget_limits must map category names to positive amounts' });
                }
                patch.budget_limits = v;
            }
            if ('giving_floor_pct' in body) {
                const n = Number(body.giving_floor_pct);
                if (!Number.isFinite(n) || n < 0 || n > 100) {
                    return json(400, { error: 'giving_floor_pct must be between 0 and 100' });
                }
                patch.giving_floor_pct = n;
            }
            if ('giving_floor_category' in body) {
                if (body.giving_floor_category === '') patch.giving_floor_category = '';
                else {
                    const v = cleanString(body.giving_floor_category, 40);
                    if (!v) return json(400, { error: 'giving_floor_category must be 1-40 characters' });
                    patch.giving_floor_category = v;
                }
            }
            if (Object.keys(patch).length === 0) return json(400, { error: 'Nothing to update' });

            const { error } = await upsertSettings(supabase, {
                ...patch,
                user_id: user.id,
                updated_at: new Date().toISOString()
            });
            if (error) throw error;
            return json(200, { ok: true });
        }

        return json(405, { error: 'Method not allowed' });
    } catch (err) {
        console.error('settings error:', err);
        return json(500, { error: 'Internal server error' });
    }
};

exports.handler = withLogging('settings', handler);
