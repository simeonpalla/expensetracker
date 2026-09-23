// forgot-password.js — POST { email } -> emails a password-reset link.
// Always answers the same way whether or not the address is registered,
// so it can't be used to discover who has an account.

const { json, anonClient, readJsonBody, rateLimit, clientIp, isEmail, withLogging } = require('./_lib');

const handler = async function (event) {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    if (!rateLimit('forgot', clientIp(event), 3, 60 * 60 * 1000)) {
        return json(429, { error: 'Too many requests. Try again later.' });
    }

    const parsed = readJsonBody(event);
    if (!parsed.ok) return parsed.response;
    const { email } = parsed.body;
    if (!isEmail(email)) return json(400, { error: 'Enter a valid email address.' });

    // The reset link must land back on this app. Taken from server config,
    // never from the request, so it can't be steered elsewhere.
    const siteUrl = process.env.SITE_URL || process.env.URL;
    const { error } = await anonClient().auth.resetPasswordForEmail(
        email,
        siteUrl ? { redirectTo: siteUrl } : undefined
    );
    if (error) console.error('forgot-password error:', error.message);

    return json(200, { ok: true });
};

exports.handler = withLogging('forgot-password', handler);
