// onboarding.js — POST: first-run setup for a brand-new account.
// Seeds default categories (only if the user has none, so it can never
// duplicate or touch an existing user's data), adds a Cash account, and
// stamps onboarded_at. Idempotent.

const { json, requireUser, withLogging } = require('./_lib');
const { countCategories, insertCategories, insertAccounts, upsertSettings } = require('./lib/settings-repo');

const DEFAULT_CATEGORIES = [
    ['Salary', 'income', '💰'],
    ['Other Income', 'income', '➕'],
    ['Food & Dining', 'expense', '🍽️'],
    ['Groceries', 'expense', '🛒'],
    ['Transport', 'expense', '🚌'],
    ['Rent', 'expense', '🏠'],
    ['Bills & Utilities', 'expense', '💡'],
    ['Shopping', 'expense', '🛍️'],
    ['Health', 'expense', '💊'],
    ['Entertainment', 'expense', '🎬'],
    ['Other', 'expense', '📁']
];

const handler = async function (event) {
    try {
        if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
        const auth = await requireUser(event);
        if (!auth) return json(401, { error: 'Not signed in' });
        const { user, supabase } = auth;

        const { count, error: countError } = await countCategories(supabase, user.id);
        if (countError) throw countError;

        let seeded = false;
        if (!count) {
            const { error } = await insertCategories(
                supabase,
                DEFAULT_CATEGORIES.map(([name, type, icon]) => ({ user_id: user.id, name, type, icon }))
            );
            if (error) throw error;
            const { error: accError } = await insertAccounts(supabase, [
                { user_id: user.id, name: 'Cash', type: 'cash' }
            ]);
            if (accError) throw accError;
            seeded = true;
        }

        const now = new Date().toISOString();
        const { error } = await upsertSettings(supabase, {
            user_id: user.id,
            onboarded_at: now,
            updated_at: now
        });
        if (error) throw error;
        return json(200, { ok: true, seeded });
    } catch (err) {
        console.error('onboarding error:', err);
        return json(500, { error: 'Internal server error' });
    }
};

exports.handler = withLogging('onboarding', handler);
