// _lib.js — shared helpers for all Netlify functions.
//
// Auth model: the browser never sees tokens. login/signup/refresh set the
// Supabase session as HttpOnly cookies; every function reads the access token
// from the cookie (with a temporary Authorization-header fallback so clients
// running the previous script.js keep working until their cache refreshes).
//
// Data access: functions use the ANON key plus the caller's JWT, so Postgres
// RLS policies are the enforcement boundary. The service-role key must not be
// used in request handling.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ACCESS_COOKIE = 'sb-access-token';
const REFRESH_COOKIE = 'sb-refresh-token';
const COOKIE_PATH = '/.netlify/functions/';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 60; // 60 days

const MAX_BODY_BYTES = 20 * 1024; // no endpoint here needs more than 20 KB

// ---------- responses ----------

function json(statusCode, body, extra = {}) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', ...(extra.headers || {}) },
        ...(extra.multiValueHeaders ? { multiValueHeaders: extra.multiValueHeaders } : {}),
        body: JSON.stringify(body)
    };
}

// ---------- cookies ----------

function parseCookies(event) {
    const header = event.headers.cookie || event.headers.Cookie || '';
    const out = {};
    header.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        const name = part.slice(0, idx).trim();
        if (name) out[name] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return out;
}

function cookie(name, value, maxAge) {
    const attrs = [
        `${name}=${encodeURIComponent(value)}`,
        `Path=${COOKIE_PATH}`,
        `Max-Age=${maxAge}`,
        'HttpOnly',
        'Secure',
        'SameSite=Strict'
    ];
    return attrs.join('; ');
}

function sessionCookies(session) {
    const accessMaxAge = Number(session.expires_in) > 0 ? Number(session.expires_in) : 3600;
    return [
        cookie(ACCESS_COOKIE, session.access_token, accessMaxAge),
        cookie(REFRESH_COOKIE, session.refresh_token, REFRESH_MAX_AGE)
    ];
}

function clearSessionCookies() {
    return [cookie(ACCESS_COOKIE, '', 0), cookie(REFRESH_COOKIE, '', 0)];
}

// ---------- auth ----------

function getAccessToken(event) {
    const cookies = parseCookies(event);
    if (cookies[ACCESS_COOKIE]) return cookies[ACCESS_COOKIE];
    // Fallback for clients still running the pre-cookie frontend.
    const auth = event.headers.authorization || event.headers.Authorization || '';
    if (auth.startsWith('Bearer ')) {
        const token = auth.slice(7).trim();
        if (token) return token;
    }
    return null;
}

function getRefreshToken(event) {
    return parseCookies(event)[REFRESH_COOKIE] || null;
}

function anonClient(token) {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
}

// Returns { user, token, supabase } or null when unauthenticated.
async function requireUser(event) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Server not configured');
    const token = getAccessToken(event);
    if (!token) return null;
    const supabase = anonClient(token);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return { user: data.user, token, supabase };
}

// ---------- request body ----------

// Returns { ok: true, body } or { ok: false, response }.
function readJsonBody(event) {
    const raw = event.body || '';
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
        return { ok: false, response: json(413, { error: 'Payload too large' }) };
    }
    try {
        const body = JSON.parse(raw || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return { ok: false, response: json(400, { error: 'Body must be a JSON object' }) };
        }
        return { ok: true, body };
    } catch {
        return { ok: false, response: json(400, { error: 'Invalid JSON' }) };
    }
}

// ---------- rate limiting ----------
//
// In-memory sliding window, per lambda instance. Netlify may run several
// instances, so real limits can be a small multiple of the configured ones —
// still enough to stop credential stuffing from a single source. Documented
// in the README.

const rateBuckets = new Map();

function rateLimit(bucket, key, limit, windowMs) {
    const now = Date.now();
    const id = `${bucket}:${key}`;
    let hits = rateBuckets.get(id) || [];
    hits = hits.filter(t => now - t < windowMs);
    if (hits.length >= limit) {
        rateBuckets.set(id, hits);
        return false;
    }
    hits.push(now);
    rateBuckets.set(id, hits);
    if (rateBuckets.size > 5000) {
        // prevent unbounded growth on long-lived instances
        for (const [k, v] of rateBuckets) {
            if (v.length === 0 || now - v[v.length - 1] > windowMs) rateBuckets.delete(k);
        }
    }
    return true;
}

function clientIp(event) {
    return (
        event.headers['x-nf-client-connection-ip'] ||
        (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        'unknown'
    );
}

// ---------- validators ----------

function isDateStr(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function isIsoTimestamp(v) {
    if (typeof v !== 'string' || v.length > 40) return false;
    return !Number.isNaN(new Date(v).getTime());
}

function cleanString(v, maxLen) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s || s.length > maxLen) return null;
    return s;
}

function isEmail(v) {
    return typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

module.exports = {
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    json,
    parseCookies,
    sessionCookies,
    clearSessionCookies,
    getAccessToken,
    getRefreshToken,
    anonClient,
    requireUser,
    readJsonBody,
    rateLimit,
    clientIp,
    isDateStr,
    isIsoTimestamp,
    cleanString,
    isEmail
};
