// logout.js — POST -> revokes the session server-side (best effort) and
// clears the session cookies.

const { json, requireUser, clearSessionCookies, withLogging } = require('./_lib');

const handler = async function (event) {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    try {
        const auth = await requireUser(event);
        if (auth) await auth.supabase.auth.signOut();
    } catch (err) {
        console.warn('logout: revoke failed', err.message);
    }

    return json(
        200,
        { ok: true },
        {
            multiValueHeaders: { 'Set-Cookie': clearSessionCookies() }
        }
    );
};

exports.handler = withLogging('logout', handler);
