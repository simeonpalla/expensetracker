// ============================================================
// TIMELOGS FUNCTION
// GET    /timelogs            -> list all time_logs for user (desc by start_time)
// GET    /timelogs?date=YYYY  -> list for a specific date
// POST   /timelogs            -> insert a new time_log
// PUT    /timelogs?id=123     -> update a time_log
// DELETE /timelogs?id=123     -> delete a time_log
// ============================================================

const { json, requireUser, readJsonBody, isDateStr, isIsoTimestamp, cleanString } = require('./_lib');

const ALLOWED_CATEGORIES = ['Work', 'Health', 'Personal', 'Leisure', 'Sleep'];
const MAX_DURATION_SECONDS = 60 * 60 * 24 * 7; // one week per entry is already absurd

function validateTimeLog(body) {
    const errors = [];
    if (!cleanString(body.activity, 200)) {
        errors.push('activity is required (max 200 chars)');
    }
    if (!body.category || !ALLOWED_CATEGORIES.includes(body.category)) {
        errors.push(`category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`);
    }
    if (!isIsoTimestamp(body.start_time)) errors.push('start_time must be an ISO timestamp');
    if (!isIsoTimestamp(body.end_time)) errors.push('end_time must be an ISO timestamp');
    const dur = Number(body.duration_seconds);
    if (body.duration_seconds == null || !Number.isFinite(dur) || dur < 0 || dur > MAX_DURATION_SECONDS) {
        errors.push('duration_seconds must be between 0 and 604800');
    }
    if (!isDateStr(body.date)) errors.push('date is required (YYYY-MM-DD)');
    if (body.notes != null && body.notes !== '' && !cleanString(body.notes, 500)) {
        errors.push('notes max 500 chars');
    }
    return errors;
}

exports.handler = async (event) => {
    const auth = await requireUser(event);
    if (!auth) return json(401, { error: 'Unauthorized' });
    const { supabase } = auth;
    const userId = auth.user.id;

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

            for (const p of ['date', 'from', 'to']) {
                if (params[p] && !isDateStr(params[p])) return json(400, { error: `${p} must be YYYY-MM-DD` });
            }
            if (params.date) query = query.eq('date', params.date);
            if (params.from) query = query.gte('date', params.from);
            if (params.to)   query = query.lte('date', params.to);

            const { data, error } = await query;
            if (error) throw error;
            return json(200, data || []);
        }

        // ── POST ──
        if (method === 'POST') {
            const parsed = readJsonBody(event);
            if (!parsed.ok) return parsed.response;
            const body = parsed.body;

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

            const parsed = readJsonBody(event);
            if (!parsed.ok) return parsed.response;
            const body = parsed.body;

            const updatePayload = {};
            if (body.activity !== undefined) {
                const s = cleanString(body.activity, 200);
                if (!s) return json(400, { error: 'activity is required (max 200 chars)' });
                updatePayload.activity = s;
            }
            if (body.category !== undefined) {
                if (!ALLOWED_CATEGORIES.includes(body.category)) {
                    return json(400, { error: 'Invalid category' });
                }
                updatePayload.category = body.category;
            }
            if (body.start_time !== undefined) {
                if (!isIsoTimestamp(body.start_time)) return json(400, { error: 'start_time must be an ISO timestamp' });
                updatePayload.start_time = body.start_time;
            }
            if (body.end_time !== undefined) {
                if (!isIsoTimestamp(body.end_time)) return json(400, { error: 'end_time must be an ISO timestamp' });
                updatePayload.end_time = body.end_time;
            }
            if (body.duration_seconds !== undefined) {
                const dur = Number(body.duration_seconds);
                if (!Number.isFinite(dur) || dur < 0 || dur > MAX_DURATION_SECONDS) {
                    return json(400, { error: 'duration_seconds must be between 0 and 604800' });
                }
                updatePayload.duration_seconds = Math.floor(dur);
            }
            if (body.date !== undefined) {
                if (!isDateStr(body.date)) return json(400, { error: 'date must be YYYY-MM-DD' });
                updatePayload.date = body.date;
            }
            if (body.notes !== undefined) {
                updatePayload.notes = body.notes ? (cleanString(body.notes, 500) || null) : null;
            }

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