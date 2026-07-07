// categories.js
// GET  /categories -> list the caller's categories
// POST /categories -> insert a category (whitelisted fields)
//
// Uses the anon key + caller JWT: RLS is the enforcement boundary.

const { json, requireUser, readJsonBody, cleanString } = require('./_lib');

exports.handler = async function (event) {
    try {
        const auth = await requireUser(event);
        if (!auth) return json(401, { error: 'Not signed in' });
        const { user, supabase } = auth;

        if (event.httpMethod === 'GET') {
            const { data, error } = await supabase
                .from('categories')
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
            if (body.type !== 'income' && body.type !== 'expense') {
                return json(400, { error: 'type must be income or expense' });
            }
            // Icons are emoji; grapheme clusters can span several UTF-16 units.
            const icon = cleanString(body.icon, 8) || '📁';

            const { error } = await supabase
                .from('categories')
                .insert([{ user_id: user.id, name, type: body.type, icon }]);
            if (error) throw error;
            return json(200, { ok: true });
        }

        return json(405, { error: 'Method not allowed' });
    } catch (err) {
        console.error('categories error:', err);
        return json(500, { error: 'Internal server error' });
    }
};
