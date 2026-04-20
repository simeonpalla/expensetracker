// ============================================================
// ACTIVE-TIMER FUNCTION
// GET    /active-timer  -> return the user's active timer (or null)
// POST   /active-timer  -> upsert (start) an active timer
// DELETE /active-timer  -> clear the user's active timer
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ALLOWED_CATEGORIES = ['Work', 'Health', 'Personal', 'Leisure', 'Sleep'];

function json(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

function getAuthClient(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return null;

    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

exports.handler = async (event) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return json(500, { error: 'Server not configured' });
    }

    const supabase = getAuthClient(event.headers.authorization || event.headers.Authorization);
    if (!supabase) return json(401, { error: 'Unauthorized' });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: 'Unauthorized' });
    const userId = userData.user.id;

    const method = event.httpMethod;

    try {
        // ── GET ── fetch active timer (may not exist)
        if (method === 'GET') {
            const { data, error } = await supabase
                .from('active_timers')
                .select('*')
                .eq('user_id', userId)
                .maybeSingle();

            if (error) throw error;
            return json(200, data || null);
        }

        // ── POST ── start/replace active timer
        if (method === 'POST') {
            let body;
            try { body = JSON.parse(event.body || '{}'); }
            catch { return json(400, { error: 'Invalid JSON' }); }

            if (!body.activity || typeof body.activity !== 'string' || !body.activity.trim()) {
                return json(400, { error: 'activity is required' });
            }
            if (!body.category || !ALLOWED_CATEGORIES.includes(body.category)) {
                return json(400, { error: `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` });
            }
            if (!body.start_epoch_ms || isNaN(Number(body.start_epoch_ms))) {
                return json(400, { error: 'start_epoch_ms is required and must be a number' });
            }
            if (!body.date) {
                return json(400, { error: 'date is required (YYYY-MM-DD)' });
            }

            const payload = {
                user_id: userId,
                activity: String(body.activity).trim(),
                category: body.category,
                start_epoch_ms: Math.floor(Number(body.start_epoch_ms)),
                date: body.date
            };

            // Upsert on user_id (UNIQUE) so starting a new timer replaces any existing one
            const { data, error } = await supabase
                .from('active_timers')
                .upsert(payload, { onConflict: 'user_id' })
                .select()
                .single();

            if (error) throw error;
            return json(201, data);
        }

        // ── DELETE ── clear active timer
        if (method === 'DELETE') {
            const { error } = await supabase
                .from('active_timers')
                .delete()
                .eq('user_id', userId);

            if (error) throw error;
            return { statusCode: 204, body: '' };
        }

        return json(405, { error: 'Method not allowed' });

    } catch (err) {
        console.error('active-timer error:', err);
        return json(500, { error: err.message || 'Internal server error' });
    }
};