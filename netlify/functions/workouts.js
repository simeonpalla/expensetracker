// ============================================================
// WORKOUTS FUNCTION
// GET    /workouts            -> list all workouts for user (desc by date)
// GET    /workouts?exercise=X -> list workouts containing a specific exercise
// POST   /workouts            -> insert a parsed workout
// PUT    /workouts?id=123     -> update a workout
// DELETE /workouts?id=123     -> delete a workout
// ============================================================

const { json, requireUser, readJsonBody, isDateStr, cleanString } = require('./_lib');

const MAX_EXERCISES = 50;
const MAX_SETS_PER_EXERCISE = 50;

function validateWorkout(body) {
    const errors = [];
    if (!isDateStr(body.date)) errors.push('date is required (YYYY-MM-DD)');
    if (!cleanString(body.workout_type, 120)) {
        errors.push('workout_type is required (max 120 chars)');
    }
    if (!Array.isArray(body.exercises)) {
        errors.push('exercises must be an array');
    } else if (body.exercises.length > MAX_EXERCISES) {
        errors.push(`exercises max ${MAX_EXERCISES}`);
    }
    return errors;
}

function sanitizeExercises(exercises) {
    if (!Array.isArray(exercises)) return [];
    return exercises
        .slice(0, MAX_EXERCISES)
        .map(ex => ({
            name: String(ex.name || '')
                .trim()
                .slice(0, 120),
            sets: Array.isArray(ex.sets)
                ? ex.sets.slice(0, MAX_SETS_PER_EXERCISE).map(s => ({
                      reps: s.reps != null ? Number(s.reps) : null,
                      weight_kg: s.weight_kg != null ? Number(s.weight_kg) : null,
                      distance_mi: s.distance_mi != null ? Number(s.distance_mi) : null,
                      duration_min: s.duration_min != null ? Number(s.duration_min) : null
                  }))
                : []
        }))
        .filter(ex => ex.name);
}

exports.handler = async event => {
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
                .from('workouts')
                .select('*')
                .eq('user_id', userId)
                .order('date', { ascending: false });

            for (const p of ['from', 'to']) {
                if (params[p] && !isDateStr(params[p]))
                    return json(400, { error: `${p} must be YYYY-MM-DD` });
            }
            if (params.from) query = query.gte('date', params.from);
            if (params.to) query = query.lte('date', params.to);

            const { data, error } = await query;
            if (error) throw error;

            let results = data || [];

            // Optional client-side-ish filter by exercise name (case-insensitive substring)
            if (params.exercise) {
                const needle = String(params.exercise).toLowerCase();
                results = results.filter(
                    w =>
                        Array.isArray(w.exercises) &&
                        w.exercises.some(ex =>
                            String(ex.name || '')
                                .toLowerCase()
                                .includes(needle)
                        )
                );
            }

            return json(200, results);
        }

        // ── POST ──
        if (method === 'POST') {
            const parsed = readJsonBody(event);
            if (!parsed.ok) return parsed.response;
            const body = parsed.body;

            const errors = validateWorkout(body);
            if (errors.length) return json(400, { error: errors.join('; ') });

            const insertPayload = {
                user_id: userId,
                date: body.date,
                workout_type: String(body.workout_type).trim().slice(0, 120),
                start_time_str: body.start_time_str ? String(body.start_time_str).trim().slice(0, 40) : null,
                raw_text: body.raw_text ? String(body.raw_text).slice(0, 10000) : null,
                exercises: sanitizeExercises(body.exercises),
                duration_minutes:
                    body.duration_minutes != null ? Math.floor(Number(body.duration_minutes)) : null
            };

            const { data, error } = await supabase.from('workouts').insert(insertPayload).select().single();

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
            if (body.date !== undefined) {
                if (!isDateStr(body.date)) return json(400, { error: 'date must be YYYY-MM-DD' });
                updatePayload.date = body.date;
            }
            if (body.workout_type !== undefined)
                updatePayload.workout_type = String(body.workout_type).trim().slice(0, 120);
            if (body.start_time_str !== undefined)
                updatePayload.start_time_str = body.start_time_str
                    ? String(body.start_time_str).trim().slice(0, 40)
                    : null;
            if (body.raw_text !== undefined)
                updatePayload.raw_text = body.raw_text ? String(body.raw_text).slice(0, 10000) : null;
            if (body.exercises !== undefined) updatePayload.exercises = sanitizeExercises(body.exercises);
            if (body.duration_minutes !== undefined)
                updatePayload.duration_minutes =
                    body.duration_minutes != null ? Math.floor(Number(body.duration_minutes)) : null;

            const { data, error } = await supabase
                .from('workouts')
                .update(updatePayload)
                .eq('id', id)
                .eq('user_id', userId)
                .select()
                .single();

            if (error) throw error;
            if (!data) return json(404, { error: 'Not found' });
            return json(200, data);
        }

        // ── DELETE ──
        if (method === 'DELETE') {
            const id = params.id;
            if (!id) return json(400, { error: 'id query parameter required' });

            const { error } = await supabase.from('workouts').delete().eq('id', id).eq('user_id', userId);

            if (error) throw error;
            return { statusCode: 204, body: '' };
        }

        return json(405, { error: 'Method not allowed' });
    } catch (err) {
        console.error('workouts error:', err);
        return json(500, { error: err.message || 'Internal server error' });
    }
};
