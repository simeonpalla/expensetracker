// transactions.js
// GET    /transactions        -> list the caller's transactions (desc by date)
// POST   /transactions        -> insert a transaction (whitelisted fields)
// PUT    /transactions?id=X   -> update a transaction (whitelisted fields)
// DELETE /transactions?id=X   -> delete a transaction
//
// Uses the anon key + caller JWT: RLS is the enforcement boundary; the
// explicit user_id filters are defence in depth.

const { json, requireUser, readJsonBody, isDateStr, cleanString } = require('./_lib');

const PAYMENT_SOURCES = ['upi', 'credit-card', 'debit-card', 'cash', 'salary'];
const MAX_AMOUNT = 100000000; // ₹10 crore sanity cap

// Validates one field; returns { value } or { error }.
const FIELDS = {
    type(v) {
        return v === 'income' || v === 'expense' ? { value: v } : { error: 'type must be income or expense' };
    },
    amount(v) {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return { error: 'amount must be a positive number' };
        return { value: Math.round(n * 100) / 100 };
    },
    category(v) {
        const s = cleanString(v, 60);
        return s ? { value: s } : { error: 'category is required (max 60 chars)' };
    },
    transaction_date(v) {
        return isDateStr(v) ? { value: v } : { error: 'transaction_date must be YYYY-MM-DD' };
    },
    payment_to(v) {
        const s = cleanString(v, 120);
        return s ? { value: s } : { error: 'payment_to is required (max 120 chars)' };
    },
    payment_source(v) {
        return PAYMENT_SOURCES.includes(v) ? { value: v } : { error: `payment_source must be one of: ${PAYMENT_SOURCES.join(', ')}` };
    },
    source_details(v) {
        if (v == null || v === '') return { value: null };
        const s = cleanString(v, 60);
        return s ? { value: s } : { error: 'source_details max 60 chars' };
    },
    description(v) {
        if (v == null || v === '') return { value: null };
        const s = cleanString(v, 500);
        return s ? { value: s } : { error: 'description max 500 chars' };
    },
    is_recurring(v) {
        if (v == null) return { value: false };
        return typeof v === 'boolean' ? { value: v } : { error: 'is_recurring must be a boolean' };
    }
};

const REQUIRED_ON_INSERT = ['type', 'amount', 'category', 'transaction_date', 'payment_to', 'payment_source'];

// Builds a sanitized payload from body. requireAll=true for POST, false for PUT.
function buildPayload(body, requireAll) {
    const payload = {};
    const errors = [];
    for (const [field, validate] of Object.entries(FIELDS)) {
        const present = body[field] !== undefined;
        if (!present) {
            if (requireAll && REQUIRED_ON_INSERT.includes(field)) {
                errors.push(`${field} is required`);
            } else if (requireAll) {
                // optional fields get their defaults on insert (null / false)
                const r = validate(undefined);
                if (!r.error) payload[field] = r.value;
            }
            continue;
        }
        const r = validate(body[field]);
        if (r.error) errors.push(r.error);
        else payload[field] = r.value;
    }
    return { payload, errors };
}

exports.handler = async function (event) {
    try {
        const auth = await requireUser(event);
        if (!auth) return json(401, { error: 'Not signed in' });
        const { user, supabase } = auth;
        const { id } = event.queryStringParameters || {};

        if (event.httpMethod === 'GET') {
            const { data, error } = await supabase
                .from('transactions')
                .select('*')
                .eq('user_id', user.id)
                .order('transaction_date', { ascending: false });
            if (error) throw error;
            return json(200, data || []);
        }

        if (event.httpMethod === 'POST') {
            const parsed = readJsonBody(event);
            if (!parsed.ok) return parsed.response;

            const { payload, errors } = buildPayload(parsed.body, true);
            if (errors.length) return json(400, { error: errors.join('; ') });
            payload.user_id = user.id;

            const { error } = await supabase.from('transactions').insert([payload]);
            if (error) throw error;
            return json(200, { ok: true });
        }

        if (event.httpMethod === 'PUT') {
            if (!id) return json(400, { error: 'id query parameter required' });
            const parsed = readJsonBody(event);
            if (!parsed.ok) return parsed.response;

            const { payload, errors } = buildPayload(parsed.body, false);
            if (errors.length) return json(400, { error: errors.join('; ') });
            if (Object.keys(payload).length === 0) return json(400, { error: 'No valid fields to update' });

            const { error } = await supabase
                .from('transactions')
                .update(payload)
                .eq('id', id)
                .eq('user_id', user.id);
            if (error) throw error;
            return json(200, { ok: true });
        }

        if (event.httpMethod === 'DELETE') {
            if (!id) return json(400, { error: 'id query parameter required' });
            const { error } = await supabase
                .from('transactions')
                .delete()
                .eq('id', id)
                .eq('user_id', user.id);
            if (error) throw error;
            return json(200, { ok: true });
        }

        return json(405, { error: 'Method not allowed' });
    } catch (err) {
        console.error('transactions error:', err);
        return json(500, { error: 'Internal server error' });
    }
};
