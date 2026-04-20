// ============================================================
// TIMELOGS FUNCTION
// GET    /timelogs            -> list all time_logs for user (desc by start_time)
// GET    /timelogs?date=YYYY  -> list for a specific date
// POST   /timelogs            -> insert a new time_log
// PUT    /timelogs?id=123     -> update a time_log
// DELETE /timelogs?id=123     -> delete a time_log
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

function validateTimeLog(body) {
    const errors = [];
    if (!body.activity || typeof body.activity !== 'string' || !body.activity.trim()) {
        errors.push('activity is required');
    }
    if (!body.category || !ALLOWED_CATEGORIES.includes(body.category)) {
        errors.push(`category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`);
    }
    if (!body.start_time) errors.push('start_time is required');
    if (!body.end_time) errors.push('end_time is required');
    if (body.duration_seconds == null || Number(body.duration_seconds) < 0) {
        errors.push('duration_seconds must be a non-negative number');
    }
    if (!body.date) errors.push('date is required (YYYY-MM-DD)');
    return errors;
}

exports.handler = async (event) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return json(500, { error: 'Server not configured' });
    }

    const supabase = getAuthClient(event.headers.authorization || event.headers.Authorization);
    if (!supabase) return json(401, { error: 'Unauthorized' });

    // Verify the token corresponds to a real user
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: 'Unauthorized' });
    const userId = userData.user.id;

    const method = event.httpMethod;
    const params = event.queryStringParameters || {};

    try {
        // ── GET ──
        if (method === 'GET') {
            let query = supabase
                .from('time_logs')
                .select('*')
                .eq('user_id', userId)
                .order('start_time', { ascending: false });

            if (params.date) query = query.eq('date', params.date);
            if (params.from) query = query.gte('date', params.from);
            if (params.to)   query = query.lte('date', params.to);

            const { data, error } = await query;
            if (error) throw error;
            return json(200, data || []);
        }

        // ── POST ──
        if (method === 'POST') {
            let body;
            try { body = JSON.parse(event.body || '{}'); }
            catch { return json(400, { error: 'Invalid JSON' }); }

            const errors = validateTimeLog(body);
            if (errors.length) return json(400, { error: errors.join('; ') });

            const insertPayload = {
                user_id: userId,
                activity: String(body.activity).trim(),
                category: body.category,
                start_time: body.start_time,
                end_time: body.end_time,
                duration_seconds: Math.floor(Number(body.duration_seconds)),
                date: body.date,
                notes: body.notes ? String(body.notes).trim() : null
            };

            const { data, error } = await supabase
                .from('time_logs')
                .insert(insertPayload)
                .select()
                .single();

            if (error) throw error;
            return json(201, data);
        }

        // ── PUT ──
        if (method === 'PUT') {
            const id = params.id;
            if (!id) return json(400, { error: 'id query parameter required' });

            let body;
            try { body = JSON.parse(event.body || '{}'); }
            catch { return json(400, { error: 'Invalid JSON' }); }

            const updatePayload = {};
            if (body.activity !== undefined)         updatePayload.activity = String(body.activity).trim();
            if (body.category !== undefined) {
                if (!ALLOWED_CATEGORIES.includes(body.category)) {
                    return json(400, { error: 'Invalid category' });
                }
                updatePayload.category = body.category;
            }
            if (body.start_time !== undefined)       updatePayload.start_time = body.start_time;
            if (body.end_time !== undefined)         updatePayload.end_time = body.end_time;
            if (body.duration_seconds !== undefined) updatePayload.duration_seconds = Math.floor(Number(body.duration_seconds));
            if (body.date !== undefined)             updatePayload.date = body.date;
            if (body.notes !== undefined)            updatePayload.notes = body.notes ? String(body.notes).trim() : null;

            const { data, error } = await supabase
                .from('time_logs')
                .update(updatePayload)
                .eq('id', id)
                .eq('user_id', userId)
                .select()
                .single();

            if (error) throw error;
            if (!data)  return json(404, { error: 'Not found' });
            return json(200, data);
        }

        // ── DELETE ──
        if (method === 'DELETE') {
            const id = params.id;
            if (!id) return json(400, { error: 'id query parameter required' });

            const { error } = await supabase
                .from('time_logs')
                .delete()
                .eq('id', id)
                .eq('user_id', userId);

            if (error) throw error;
            return { statusCode: 204, body: '' };
        }

        return json(405, { error: 'Method not allowed' });

    } catch (err) {
        console.error('timelogs error:', err);
        return json(500, { error: err.message || 'Internal server error' });
    }
};