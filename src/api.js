// api.js — the single BFF client. The session lives in HttpOnly cookies set
// by the functions; this layer never sees tokens. On a 401 it refreshes once
// (single-flight, so parallel 401s share one refresh call) and retries.

import { showAuthScreen } from './ui.js';

const AUTH_PATHS = ['login', 'signup', 'refresh', 'logout'];

export const API = {
    _refreshPromise: null,

    async request(path, options = {}, isRetry = false) {
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        const res = await fetch(`/.netlify/functions/${path}`, {
            ...options,
            headers,
            credentials: 'same-origin'
        });

        if (res.status === 401 && !isRetry && !AUTH_PATHS.includes(path)) {
            const refreshed = await this.refreshSession();
            if (refreshed) return this.request(path, options, true);
            showAuthScreen();
            throw new Error('Session expired. Please log in again.');
        }

        if (!res.ok) {
            let message = `Request failed (${res.status})`;
            try {
                const data = await res.json();
                if (data && data.error) message = data.error;
            } catch {
                /* non-JSON error body */
            }
            throw new Error(message);
        }

        return res.status === 204 ? null : res.json();
    },

    refreshSession() {
        if (!this._refreshPromise) {
            this._refreshPromise = fetch('/.netlify/functions/refresh', {
                method: 'POST',
                credentials: 'same-origin'
            })
                .then(r => r.ok)
                .catch(() => false);
            this._refreshPromise.finally(() => {
                this._refreshPromise = null;
            });
        }
        return this._refreshPromise;
    },

    // ---- auth ----
    me() {
        return this.request('me');
    },
    login(email, password) {
        return this.request('login', { method: 'POST', body: JSON.stringify({ email, password }) });
    },
    signup(email, password) {
        return this.request('signup', { method: 'POST', body: JSON.stringify({ email, password }) });
    },
    logout() {
        return this.request('logout', { method: 'POST' });
    },

    // ---- money ----
    getCategories() {
        return this.request('categories');
    },
    addCategory(data) {
        return this.request('categories', { method: 'POST', body: JSON.stringify(data) });
    },
    getTransactions() {
        return this.request('transactions');
    },
    addTransaction(tx) {
        return this.request('transactions', { method: 'POST', body: JSON.stringify(tx) });
    },
    updateTransaction(id, tx) {
        return this.request(`transactions?id=${id}`, { method: 'PUT', body: JSON.stringify(tx) });
    },
    deleteTransaction(id) {
        return this.request(`transactions?id=${id}`, { method: 'DELETE' });
    },

    // ---- time tracking ----
    getTimeLogs(params) {
        return this.request(withQuery('timelogs', params));
    },
    addTimeLog(data) {
        return this.request('timelogs', { method: 'POST', body: JSON.stringify(data) });
    },
    updateTimeLog(id, data) {
        return this.request(`timelogs?id=${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    deleteTimeLog(id) {
        return this.request(`timelogs?id=${id}`, { method: 'DELETE' });
    },
    getActiveTimer() {
        return this.request('activetimer');
    },
    startActiveTimer(data) {
        return this.request('activetimer', { method: 'POST', body: JSON.stringify(data) });
    },
    clearActiveTimer() {
        return this.request('activetimer', { method: 'DELETE' });
    },

    // ---- workouts ----
    getWorkouts(params) {
        return this.request(withQuery('workouts', params));
    },
    addWorkout(data) {
        return this.request('workouts', { method: 'POST', body: JSON.stringify(data) });
    },
    deleteWorkout(id) {
        return this.request(`workouts?id=${id}`, { method: 'DELETE' });
    }
};

function withQuery(path, params) {
    if (!params) return path;
    const qs = Object.entries(params)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
    return qs ? `${path}?${qs}` : path;
}

// Kept for the browser console and any stragglers; modules import { API }.
if (typeof window !== 'undefined') window.API = API;
