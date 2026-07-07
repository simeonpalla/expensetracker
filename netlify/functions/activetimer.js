// ============================================================
// ACTIVE-TIMER FUNCTION
// GET    /active-timer  -> return the user's active timer (or null)
// POST   /active-timer  -> upsert (start) an active timer
// DELETE /active-timer  -> clear the user's active timer
// ============================================================

const { json, requireUser, readJsonBody, isDateStr, cleanString } = require('./_lib');

const ALLOWED_CATEGORIES = ['Work', 'Health', 'Personal', 'Leisure', 'Sleep'];

exports.handler = async (event) => {
    const auth = await requireUser(event);
    if (!auth) return json(401, { error: 'Unauthorized' });
    const { supabase } = auth;
    const userId = auth.user.id;

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
            const parsed = readJsonBody(event);
            if (!parsed.ok) return parsed.response;
            const body = parsed.body;

            if (!cleanString(body.activity, 200)) {
                return json(400, { error: 'activity is required (max 200 chars)' });
            }
            if (!body.category || !ALLOWED_CATEGORIES.includes(body.category)) {
                return json(400, { error: `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` });
            }
            if (!body.start_epoch_ms || isNaN(Number(body.start_epoch_ms))) {
                return json(400, { error: 'start_epoch_ms is required and must be a number' });
            }
            if (!isDateStr(body.date)) {
                return json(400, { error: 'date is required (YYYY-MM-DD)' });
            }

            const payload = {
                user_id: userId,
                activity: String(body.activity).trim().slice(0, 200),
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