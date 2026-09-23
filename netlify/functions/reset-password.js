// reset-password.js — POST { access_token, password } -> sets a new
// password using the recovery token from the emailed link. The token is
// a short-lived Supabase recovery JWT; it is used once here and never
// stored. Existing sessions are not touched, so the user then logs in
// normally with the new password.

const { json, readJsonBody, rateLimit, clientIp, withLogging } = require('./_lib');

const handler = async function (event) {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    if (!rateLimit('reset', clientIp(event), 5, 60 * 60 * 1000)) {
        return json(429, { error: 'Too many attempts. Try again later.' });
    }

    const parsed = readJsonBody(event);
    if (!parsed.ok) return parsed.response;
    const { access_token: token, password } = parsed.body;

    if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
        return json(400, { error: 'This reset link is invalid or has expired.' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return json(400, { error: 'Password must be 8–128 characters.' });
    }

    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            apikey: process.env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password })
    });

    if (!res.ok) {
        console.error('reset-password: supabase responded', res.status);
        return json(400, { error: 'This reset link is invalid or has expired.' });
    }
    return json(200, { ok: true });
};

exports.handler = withLogging('reset-password', handler);
