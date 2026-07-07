// refresh.js — POST (no body) -> rotates the session using the HttpOnly
// refresh-token cookie and sets fresh cookies.

const {
    json,
    anonClient,
    getRefreshToken,
    sessionCookies,
    clearSessionCookies,
    rateLimit,
    clientIp
} = require('./_lib');

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const ip = clientIp(event);
    if (!rateLimit('refresh', ip, 30, 5 * 60 * 1000)) {
        return json(429, { error: 'Too many requests.' });
    }

    const refresh_token = getRefreshToken(event);
    if (!refresh_token) return json(401, { error: 'Not signed in' });

    const supabase = anonClient();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token });

    if (error || !data?.session) {
        return json(
            401,
            { error: 'Session expired' },
            {
                multiValueHeaders: { 'Set-Cookie': clearSessionCookies() }
            }
        );
    }

    return json(
        200,
        { user: { id: data.user.id, email: data.user.email } },
        {
            multiValueHeaders: { 'Set-Cookie': sessionCookies(data.session) }
        }
    );
};
