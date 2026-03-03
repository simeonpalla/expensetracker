// refresh.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: "Method Not Allowed" };

    try {
        const { refresh_token } = JSON.parse(event.body);

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY,
            {
                auth: { persistSession: false, autoRefreshToken: false }
            }
        );

        const { data, error } = await supabase.auth.refreshSession({ refresh_token });

        if (error) throw error;

        return {
            statusCode: 200,
            body: JSON.stringify(data.session)
        };
    } catch (err) {
        return { statusCode: 401, body: JSON.stringify({ error: err.message }) };
    }
};