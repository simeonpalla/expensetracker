// me.js — GET -> { user } when the session cookie is valid, 401 otherwise.
// Used by the frontend at boot to decide between the login screen and the app.

const { json, requireUser } = require('./_lib');

exports.handler = async function (event) {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

    try {
        const auth = await requireUser(event);
        if (!auth) return json(401, { error: 'Not signed in' });
        return json(200, { user: { id: auth.user.id, email: auth.user.email } });
    } catch (err) {
        console.error('me error:', err);
        return json(500, { error: 'Internal server error' });
    }
};
