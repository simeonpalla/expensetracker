// login.js — POST { email, password } -> sets HttpOnly session cookies.
// Tokens are never returned in the response body.

const {
    json, anonClient, readJsonBody, sessionCookies,
    rateLimit, clientIp, isEmail
} = require('./_lib');

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const ip = clientIp(event);
    if (!rateLimit('login', ip, 5, 5 * 60 * 1000)) {
        return json(429, { error: 'Too many login attempts. Try again in a few minutes.' });
    }

    const parsed = readJsonBody(event);
    if (!parsed.ok) return parsed.response;
    const { email, password } = parsed.body;

    if (!isEmail(email) || typeof password !== 'string' || password.length < 1 || password.length > 128) {
        return json(400, { error: 'Invalid email or password.' });
    }

    const supabase = anonClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data?.session) {
        // Uniform message: don't reveal whether the account exists.
        return json(401, { error: 'Invalid email or password.' });
    }

    return json(200, { user: { id: data.user.id, email: data.user.email } }, {
        multiValueHeaders: { 'Set-Cookie': sessionCookies(data.session) }
    });
};
