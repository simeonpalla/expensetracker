// ======================================================
// TIME TRACKER MODULE
// - Class TimeTracker, exposed as window.timeTracker
// - Timer state: localStorage primary, Supabase fallback
// - Elapsed always computed fresh from Date.now() - start_epoch_ms
// - setInterval used ONLY for display refresh, never for state
// ======================================================

(function () {
    'use strict';

    const LS_KEY = 'activeTimer';
    const CATEGORIES = ['Work', 'Health', 'Personal', 'Leisure', 'Sleep'];

    const CATEGORY_COLORS = {
        Work:     '#7c6aff',
        Health:   '#00d4aa',
        Personal: '#f5a623',
        Leisure:  '#ff5c72',
        Sleep:    '#3b82f6'
    };

    const CATEGORY_ICONS = {
        Work:     '💻',
        Health:   '💪',
        Personal: '🧘',
        Leisure:  '🎮',
        Sleep:    '😴'
    };

    // ===============================
    // API extensions
    // ===============================
    if (typeof window.API === 'object' && window.API) {
        window.API.getTimeLogs = function (params) {
            let path = 'timelogs';
            if (params) {
                const qs = Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
                if (qs) path += '?' + qs;
            }
            return this.request(path);
        };
        window.API.addTimeLog    = function (data)     { return this.request('timelogs', { method: 'POST', body: JSON.stringify(data) }); };
        window.API.updateTimeLog = function (id, data) { return this.request(`timelogs?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }); };
        window.API.deleteTimeLog = function (id)       { return this.request(`timelogs?id=${id}`, { method: 'DELETE' }); };

        window.API.getActiveTimer   = function ()     { return this.request('activetimer'); };
        window.API.startActiveTimer = function (data) { return this.request('activetimer', { method: 'POST', body: JSON.stringify(data) }); };
        window.API.clearActiveTimer = function ()     { return this.request('activetimer', { method: 'DELETE' }); };
    }

    // ===============================
    // Helpers
    // ===============================
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toDateStr(d) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function formatDuration(totalSeconds, compact = false) {
        const s = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (compact) {
            if (h > 0) return `${h}h ${m}m`;
            if (m > 0) return `${m}m`;
            return `${sec}s`;
        }
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    }

    function parseLocalTime(dateStr, timeStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const [hh, mm] = timeStr.split(':').map(Number);
        return new Date(y, m - 1, d, hh, mm, 0, 0);
    }

    function showGenericConfirm(title, message, onConfirm) {
        const overlay = document.getElementById('generic-confirm-modal-overlay');
        document.getElementById('generic-confirm-title').textContent = title;
        document.getElementById('generic-confirm-message').textContent = message;
        const yes = document.getElementById('generic-confirm-yes');
        const no  = document.getElementById('generic-confirm-no');
        const newYes = yes.cloneNode(true);
        const newNo  = no.cloneNode(true);
        yes.parentNode.replaceChild(newYes, yes);
        no.parentNode.replaceChild(newNo, no);
        const close = () => { overlay.style.display = 'none'; };
        newYes.addEventListener('click', () => { close(); onConfirm(); });
        newNo.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); }, { once: true });
        overlay.style.display = 'flex';
    }

    // ===============================
    // TimeTracker class
    // ===============================
    class TimeTracker {
        constructor() {
            this.logs = [];
            this.activeTimer = null;
            this.displayIntervalId = null;
            this.viewDate = toDateStr(new Date());
            this.weeklyChart = null;
            this.initialized = false;
        }

        async init() {
            if (this.initialized) return;
            this.initialized = true;
            this.setupEventListeners();
            const picker = document.getElementById('time-view-date');
            if (picker) picker.value = this.viewDate;
            const manualDate = document.getElementById('manual-date');
            if (manualDate) manualDate.value = this.viewDate;
            await this.restoreActiveTimer();
            await this.loadLogs();
            this.renderAll();
        }

        setupEventListeners() {
            const qs = id => document.getElementById(id);
            qs('timer-start-form')?.addEventListener('submit', e => this.handleStartTimer(e));
            qs('stop-timer-btn')?.addEventListener('click', () => this.stopTimer());
            qs('timelog-manual-form')?.addEventListener('submit', e => this.handleManualSubmit(e));
            qs('manual-clear-btn')?.addEventListener('click', () => {
                qs('timelog-manual-form')?.reset();
                const md = qs('manual-date'); if (md) md.value = this.viewDate;
            });
            qs('time-view-date')?.addEventListener('change', e => {
                this.viewDate = e.target.value || toDateStr(new Date());
                this.renderDailyView();
            });
            document.querySelectorAll('.time-quick-btn').forEach(btn => {
                btn.addEventListener('click', () => this.startTimer(btn.dataset.activity, btn.dataset.category));
            });
            // Delegated delete clicks (rows are rendered via innerHTML; inline
            // handlers are blocked by the CSP).
            qs('timelog-list')?.addEventListener('click', e => {
                const btn = e.target.closest('.delete-btn');
                if (btn) this.confirmDelete(btn.dataset.id);
            });
        }

        async restoreActiveTimer() {
            let lsTimer = null;
            try {
                const raw = localStorage.getItem(LS_KEY);
                if (raw && raw !== 'undefined') lsTimer = JSON.parse(raw);
            } catch { localStorage.removeItem(LS_KEY); }

            if (lsTimer?.start_epoch_ms && lsTimer?.activity && lsTimer?.category) {
                this.activeTimer = lsTimer;
                this.startDisplayRefresh();
                return;
            }

            try {
                const remote = await window.API.getActiveTimer();
                if (remote?.start_epoch_ms) {
                    this.activeTimer = {
                        activity: remote.activity,
                        category: remote.category,
                        start_epoch_ms: Number(remote.start_epoch_ms),
                        date: remote.date
                    };
                    localStorage.setItem(LS_KEY, JSON.stringify(this.activeTimer));
                    this.startDisplayRefresh();
                }
            } catch (err) { console.warn('restoreActiveTimer remote failed', err); }
        }

        async handleStartTimer(e) {
            if (e) e.preventDefault();
            const activity = document.getElementById('timer-activity')?.value.trim();
            const category = document.getElementById('timer-category')?.value;
            if (!activity || !CATEGORIES.includes(category)) {
                showNotification('Enter an activity and category', 'error'); return;
            }
            await this.startTimer(activity, category);
            document.getElementById('timer-start-form')?.reset();
        }

        async startTimer(activity, category) {
            if (this.activeTimer) { showNotification('A timer is already running. Stop it first.', 'error'); return; }
            const now = Date.now();
            const timer = { activity, category, start_epoch_ms: now, date: toDateStr(new Date(now)) };
            this.activeTimer = timer;
            localStorage.setItem(LS_KEY, JSON.stringify(timer));
            this.renderActiveTimerCard();
            this.startDisplayRefresh();
            try {
                await window.API.startActiveTimer(timer);
                showNotification(`▶️ Timer started: ${activity}`);
            } catch (err) {
                showNotification('Timer started locally; sync failed: ' + err.message, 'error');
            }
        }

        async stopTimer() {
            if (!this.activeTimer) return;
            const { activity, category, start_epoch_ms, date } = this.activeTimer;
            const endMs = Date.now();
            const durationSec = Math.max(0, Math.floor((endMs - start_epoch_ms) / 1000));
            if (durationSec < 5) {
                if (!confirm('Timer ran for less than 5 seconds. Save anyway?')) {
                    await this.clearActiveTimerState(); return;
                }
            }
            const payload = {
                activity, category,
                start_time: new Date(start_epoch_ms).toISOString(),
                end_time:   new Date(endMs).toISOString(),
                duration_seconds: durationSec, date, notes: null
            };
            try {
                await window.API.addTimeLog(payload);
                await this.clearActiveTimerState();
                await this.loadLogs();
                this.renderAll();
                showNotification(`⏹ Logged ${formatDuration(durationSec, true)} of ${activity}`);
            } catch (err) { showNotification('Error saving time log: ' + err.message, 'error'); }
        }

        async clearActiveTimerState() {
            this.activeTimer = null;
            localStorage.removeItem(LS_KEY);
            this.stopDisplayRefresh();
            this.renderActiveTimerCard();
            try { await window.API.clearActiveTimer(); } catch (err) { console.warn('clearActiveTimer remote failed', err); }
        }

        startDisplayRefresh() {
            this.renderActiveTimerCard();
            this.stopDisplayRefresh();
            this.displayIntervalId = setInterval(() => this.updateElapsedDisplay(), 1000);
        }

        stopDisplayRefresh() {
            if (this.displayIntervalId) { clearInterval(this.displayIntervalId); this.displayIntervalId = null; }
        }

        updateElapsedDisplay() {
            if (!this.activeTimer) { this.stopDisplayRefresh(); return; }
            const el = document.getElementById('active-timer-elapsed');
            if (!el) return;
            el.textContent = formatDuration(Math.floor((Date.now() - this.activeTimer.start_epoch_ms) / 1000), false);
        }

        renderActiveTimerCard() {
            const card = document.getElementById('active-timer-card');
            if (!card) return;
            if (!this.activeTimer) { card.style.display = 'none'; return; }
            const { activity, category, start_epoch_ms } = this.activeTimer;
            const pill      = document.getElementById('active-timer-category-pill');
            const actEl     = document.getElementById('active-timer-activity');
            const startedEl = document.getElementById('active-timer-started-at');
            if (pill) {
                pill.textContent = `${CATEGORY_ICONS[category] || ''} ${category}`;
                pill.style.background  = CATEGORY_COLORS[category] + '22';
                pill.style.color       = CATEGORY_COLORS[category];
                pill.style.borderColor = CATEGORY_COLORS[category] + '44';
            }
            if (actEl) actEl.textContent = activity;
            if (startedEl) startedEl.textContent = new Date(start_epoch_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            card.style.display = 'block';
            this.updateElapsedDisplay();
        }

        async handleManualSubmit(e) {
            e.preventDefault();
            const activity = document.getElementById('manual-activity')?.value.trim();
            const category = document.getElementById('manual-category')?.value;
            const dateStr  = document.getElementById('manual-date')?.value;
            const startStr = document.getElementById('manual-start')?.value;
            const endStr   = document.getElementById('manual-end')?.value;
            const notes    = document.getElementById('manual-notes')?.value.trim() || null;
            if (!activity || !category || !dateStr || !startStr || !endStr) {
                showNotification('Fill all required fields', 'error'); return;
            }
            const start = parseLocalTime(dateStr, startStr);
            let end = parseLocalTime(dateStr, endStr);
            if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
            const durationSec = Math.floor((end - start) / 1000);
            if (durationSec <= 0) { showNotification('End time must be after start time', 'error'); return; }
            const payload = {
                activity, category,
                start_time: start.toISOString(), end_time: end.toISOString(),
                duration_seconds: durationSec, date: dateStr, notes
            };
            try {
                await window.API.addTimeLog(payload);
                document.getElementById('timelog-manual-form')?.reset();
                const md = document.getElementById('manual-date'); if (md) md.value = this.viewDate;
                await this.loadLogs();
                this.renderAll();
                showNotification(`✅ Logged ${formatDuration(durationSec, true)} of ${activity}`);
            } catch (err) { showNotification('Error saving: ' + err.message, 'error'); }
        }

        async loadLogs() {
            try {
                const from = new Date(); from.setDate(from.getDate() - 60);
                this.logs = await window.API.getTimeLogs({ from: toDateStr(from) }) || [];
            } catch (err) { console.error('loadLogs failed', err); this.logs = []; }
        }

        renderAll() { this.renderDailyView(); this.renderWeeklyChart(); this.renderLogList(); }

        renderDailyView() {
            const dayLogs = this.getLogsForDate(this.viewDate);
            this.renderDailyStats(dayLogs);
            this.renderTimeline(dayLogs);
            this.renderLogList();
        }

        getLogsForDate(dateStr) { return this.logs.filter(l => l.date === dateStr); }

        renderDailyStats(dayLogs) {
            const totals = { Work: 0, Health: 0, Personal: 0, Leisure: 0, Sleep: 0 };
            dayLogs.forEach(l => { if (totals[l.category] !== undefined) totals[l.category] += Number(l.duration_seconds); });
            const totalTracked = Object.values(totals).reduce((s, v) => s + v, 0);
            const untracked = Math.max(0, 24 * 3600 - totalTracked);
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            set('time-stat-work',      formatDuration(totals.Work, true));
            set('time-stat-health',    formatDuration(totals.Health, true));
            set('time-stat-sleep',     formatDuration(totals.Sleep, true));
            set('time-stat-leisure',   formatDuration(totals.Leisure, true));
            set('time-stat-untracked', formatDuration(untracked, true));
            const score = Math.min(100, Math.round(((totals.Work + totals.Health) / Math.max(1, 24 * 3600 - totals.Sleep)) * 100));
            set('time-stat-productivity', `${score}%`);
        }

        renderTimeline(dayLogs) {
            const container = document.getElementById('time-timeline');
            if (!container) return;
            if (!dayLogs.length) { container.innerHTML = '<div class="loading">No activity logged for this day</div>'; return; }
            const dayStart = new Date(`${this.viewDate}T00:00:00`);
            const totalMs  = 24 * 3600 * 1000;
            const segments = dayLogs.map(l => {
                const clipS = Math.max(new Date(l.start_time).getTime(), dayStart.getTime());
                const clipE = Math.min(new Date(l.end_time).getTime(), dayStart.getTime() + totalMs);
                if (clipE <= clipS) return null;
                const leftPct  = ((clipS - dayStart.getTime()) / totalMs) * 100;
                const widthPct = ((clipE - clipS) / totalMs) * 100;
                const color = CATEGORY_COLORS[l.category] || '#9490c8';
                return `<div class="timeline-seg" style="left:${leftPct}%;width:${widthPct}%;background:${color};" title="${escapeHtml(l.activity + ' · ' + l.category + ' · ' + formatDuration(l.duration_seconds, true))}"></div>`;
            }).filter(Boolean).join('');
            let ticks = '';
            for (let h = 0; h <= 24; h += 6) ticks += `<div class="timeline-tick" style="left:${(h/24*100)}%;"><span>${String(h).padStart(2,'0')}:00</span></div>`;
            container.innerHTML = `<div class="timeline-track">${segments}</div><div class="timeline-axis">${ticks}</div>`;
        }

        renderLogList() {
            const list = document.getElementById('timelog-list');
            if (!list) return;
            const dayLogs = this.getLogsForDate(this.viewDate).slice().sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
            if (!dayLogs.length) { list.innerHTML = '<div class="loading">No entries for this day</div>'; return; }
            list.innerHTML = dayLogs.map(l => {
                const color = CATEGORY_COLORS[l.category] || '#9490c8';
                const icon  = CATEGORY_ICONS[l.category] || '📁';
                const s = new Date(l.start_time), e = new Date(l.end_time);
                const timeStr = `${s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                return `<div class="transaction-item timelog-item" data-id="${l.id}">
                    <div class="transaction-content">
                        <div class="transaction-details">
                            <strong>${icon} ${escapeHtml(l.activity)}</strong>
                            <small>${timeStr} · ${escapeHtml(l.category)}${l.notes ? ' · ' + escapeHtml(l.notes) : ''}</small>
                        </div>
                        <div class="transaction-right">
                            <div class="timelog-duration" style="color:${color};">${formatDuration(l.duration_seconds, true)}</div>
                            <div class="transaction-actions">
                                <button class="tx-action-btn delete-btn" data-id="${escapeHtml(String(l.id))}" title="Delete" aria-label="Delete time log">🗑️</button>
                            </div>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        confirmDelete(id) { showGenericConfirm('Delete Time Log?', 'This entry will be permanently removed.', () => this.deleteLog(id)); }

        async deleteLog(id) {
            try {
                await window.API.deleteTimeLog(id);
                await this.loadLogs(); this.renderAll();
                showNotification('Entry deleted.');
            } catch (err) { showNotification('Error deleting: ' + err.message, 'error'); }
        }

        renderWeeklyChart() {
            const canvas = document.getElementById('time-weekly-chart');
            if (!canvas || typeof Chart === 'undefined') return;
            const endDate = new Date(`${this.viewDate}T00:00:00`);
            const days = [];
            for (let i = 6; i >= 0; i--) { const d = new Date(endDate); d.setDate(d.getDate() - i); days.push(toDateStr(d)); }
            const labels = days.map(d => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }));
            const datasets = CATEGORIES.map(cat => ({
                label: cat,
                data: days.map(d => +(this.logs.filter(l => l.date === d && l.category === cat).reduce((s, l) => s + Number(l.duration_seconds), 0) / 3600).toFixed(2)),
                backgroundColor: CATEGORY_COLORS[cat], borderWidth: 0, borderRadius: 4
            }));
            if (this.weeklyChart) this.weeklyChart.destroy();
            this.weeklyChart = new Chart(canvas.getContext('2d'), {
                type: 'bar', data: { labels, datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}h` } } },
                    scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, max: 24, title: { display: true, text: 'Hours' } } }
                }
            });
        }

        getLogs() { return this.logs; }
        getCategoryTotalsForDate(dateStr) {
            const totals = { Work: 0, Health: 0, Personal: 0, Leisure: 0, Sleep: 0 };
            this.getLogsForDate(dateStr).forEach(l => { if (totals[l.category] !== undefined) totals[l.category] += Number(l.duration_seconds); });
            return totals;
        }
    }

    window.TimeTracker = TimeTracker;
    window.timeTracker = new TimeTracker();
})();