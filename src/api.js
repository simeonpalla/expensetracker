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

    // ---- payment accounts ----
    getAccounts() {
        return this.request('accounts');
    },
    addAccount(data) {
        return this.request('accounts', { method: 'POST', body: JSON.stringify(data) });
    },
    deleteAccount(id) {
        return this.request(`accounts?id=${id}`, { method: 'DELETE' });
    }
};

// Kept for the browser console and any stragglers; modules import { API }.
if (typeof window !== 'undefined') window.API = API;
