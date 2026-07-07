// signup.js — POST { email, password } -> creates an account.
// If Supabase email confirmation is enabled, returns { needsConfirmation: true };
// otherwise sets session cookies so the user is signed in immediately.

const { json, anonClient, readJsonBody, sessionCookies, rateLimit, clientIp, isEmail } = require('./_lib');

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const ip = clientIp(event);
    if (!rateLimit('signup', ip, 3, 60 * 60 * 1000)) {
        return json(429, { error: 'Too many signup attempts. Try again later.' });
    }

    const parsed = readJsonBody(event);
    if (!parsed.ok) return parsed.response;
    const { email, password } = parsed.body;

    if (!isEmail(email)) return json(400, { error: 'Enter a valid email address.' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return json(400, { error: 'Password must be 8–128 characters.' });
    }

    const supabase = anonClient();
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
        console.error('signup error:', error.message);
        // Don't leak whether the address is already registered.
        return json(400, {
            error: 'Could not create the account. Try a different email or a stronger password.'
        });
    }

    if (data.session) {
        return json(
            200,
            { user: { id: data.user.id, email: data.user.email } },
            {
                multiValueHeaders: { 'Set-Cookie': sessionCookies(data.session) }
            }
        );
    }

    return json(200, { needsConfirmation: true });
};
