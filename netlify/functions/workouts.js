// ============================================================
// WORKOUTS FUNCTION
// GET    /workouts            -> list all workouts for user (desc by date)
// GET    /workouts?exercise=X -> list workouts containing a specific exercise
// POST   /workouts            -> insert a parsed workout
// PUT    /workouts?id=123     -> update a workout
// DELETE /workouts?id=123     -> delete a workout
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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

function validateWorkout(body) {
    const errors = [];
    if (!body.date) errors.push('date is required (YYYY-MM-DD)');
    if (!body.workout_type || typeof body.workout_type !== 'string' || !body.workout_type.trim()) {
        errors.push('workout_type is required');
    }
    if (!Array.isArray(body.exercises)) {
        errors.push('exercises must be an array');
    }
    return errors;
}

function sanitizeExercises(exercises) {
    if (!Array.isArray(exercises)) return [];
    return exercises.map(ex => ({
        name: String(ex.name || '').trim(),
        sets: Array.isArray(ex.sets) ? ex.sets.map(s => ({
            reps:         s.reps != null ? Number(s.reps) : null,
            weight_kg:    s.weight_kg != null ? Number(s.weight_kg) : null,
            distance_mi:  s.distance_mi != null ? Number(s.distance_mi) : null,
            duration_min: s.duration_min != null ? Number(s.duration_min) : null
        })) : []
    })).filter(ex => ex.name);
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
    const params = event.queryStringParameters || {};

    try {
        // ── GET ──
        if (method === 'GET') {
            let query = supabase
                .from('workouts')
                .select('*')
                .eq('user_id', userId)
                .order('date', { ascending: false });

            if (params.from) query = query.gte('date', params.from);
            if (params.to)   query = query.lte('date', params.to);

            const { data, error } = await query;
            if (error) throw error;

            let results = data || [];

            // Optional client-side-ish filter by exercise name (case-insensitive substring)
            if (params.exercise) {
                const needle = String(params.exercise).toLowerCase();
                results = results.filter(w =>
                    Array.isArray(w.exercises) &&
                    w.exercises.some(ex => String(ex.name || '').toLowerCase().includes(needle))
                );
            }

            return json(200, results);
        }

        // ── POST ──
        if (method === 'POST') {
            let body;
            try { body = JSON.parse(event.body || '{}'); }
            catch { return json(400, { error: 'Invalid JSON' }); }

            const errors = validateWorkout(body);
            if (errors.length) return json(400, { error: errors.join('; ') });

            const insertPayload = {
                user_id: userId,
                date: body.date,
                workout_type: String(body.workout_type).trim(),
                start_time_str: body.start_time_str ? String(body.start_time_str).trim() : null,
                raw_text: body.raw_text ? String(body.raw_text) : null,
                exercises: sanitizeExercises(body.exercises),
                duration_minutes: body.duration_minutes != null ? Math.floor(Number(body.duration_minutes)) : null
            };

            const { data, error } = await supabase
                .from('workouts')
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
            if (body.date !== undefined)             updatePayload.date = body.date;
            if (body.workout_type !== undefined)     updatePayload.workout_type = String(body.workout_type).trim();
            if (body.start_time_str !== undefined)   updatePayload.start_time_str = body.start_time_str ? String(body.start_time_str).trim() : null;
            if (body.raw_text !== undefined)         updatePayload.raw_text = body.raw_text;
            if (body.exercises !== undefined)        updatePayload.exercises = sanitizeExercises(body.exercises);
            if (body.duration_minutes !== undefined) updatePayload.duration_minutes = body.duration_minutes != null ? Math.floor(Number(body.duration_minutes)) : null;

            const { data, error } = await supabase
                .from('workouts')
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
                .from('workouts')
                .delete()
                .eq('id', id)
                .eq('user_id', userId);

            if (error) throw error;
            return { statusCode: 204, body: '' };
        }

        return json(405, { error: 'Method not allowed' });

    } catch (err) {
        console.error('workouts error:', err);
        return json(500, { error: err.message || 'Internal server error' });
    }
};