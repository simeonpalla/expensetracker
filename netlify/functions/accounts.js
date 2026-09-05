// accounts.js
// GET    /accounts       -> list the caller's payment accounts/cards
// POST   /accounts       -> insert a payment account (whitelisted fields)
// DELETE /accounts?id=X  -> delete a payment account
//
// Uses the anon key + caller JWT: RLS is the enforcement boundary.

const { json, requireUser, readJsonBody, cleanString } = require('./_lib');

const ACCOUNT_TYPES = ['upi', 'debit-card', 'credit-card', 'cash'];

exports.handler = async function (event) {
    try {
        const auth = await requireUser(event);
        if (!auth) return json(401, { error: 'Not signed in' });
        const { user, supabase } = auth;
        const { id } = event.queryStringParameters || {};

        if (event.httpMethod === 'GET') {
            const { data, error } = await supabase
                .from('payment_accounts')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return json(200, data || []);
        }

        if (event.httpMethod === 'POST') {
            const parsed = readJsonBody(event);
            if (!parsed.ok) return parsed.response;
            const body = parsed.body;

            const name = cleanString(body.name, 40);
            if (!name) return json(400, { error: 'name is required (max 40 chars)' });
            if (!ACCOUNT_TYPES.includes(body.type)) {
                return json(400, { error: `type must be one of: ${ACCOUNT_TYPES.join(', ')}` });
            }

            const { error } = await supabase
                .from('payment_accounts')
                .insert([{ user_id: user.id, name, type: body.type }]);
            if (error) throw error;
            return json(200, { ok: true });
        }

        if (event.httpMethod === 'DELETE') {
            if (!id) return json(400, { error: 'id query parameter required' });
            const { error } = await supabase
                .from('payment_accounts')
                .delete()
                .eq('id', id)
                .eq('user_id', user.id);
            if (error) throw error;
            return json(200, { ok: true });
        }

        return json(405, { error: 'Method not allowed' });
    } catch (err) {
        console.error('accounts error:', err);
        return json(500, { error: 'Internal server error' });
    }
};
