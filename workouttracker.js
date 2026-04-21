// ======================================================
// WORKOUT TRACKER MODULE
// - class WorkoutParser (Hevy paste → structured)
// - class WorkoutTracker (UI + persistence)
// - After saving a workout, auto-creates a time_log (category Health)
// ======================================================

(function () {
    'use strict';

    // ===============================
    // API extensions
    // ===============================
    if (typeof window.API === 'object' && window.API) {
        window.API.getWorkouts   = function (params) {
            let path = 'workouts';
            if (params) {
                const qs = Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
                if (qs) path += '?' + qs;
            }
            return this.request(path);
        };
        window.API.addWorkout    = function (data) { return this.request('workouts', { method: 'POST', body: JSON.stringify(data) }); };
        window.API.deleteWorkout = function (id)   { return this.request(`workouts?id=${id}`, { method: 'DELETE' }); };
    }

    // ===============================
    // Helpers
    // ===============================
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function toDateStr(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function showGenericConfirm(title, message, onConfirm) {
        const overlay = document.getElementById('generic-confirm-modal-overlay');
        document.getElementById('generic-confirm-title').textContent = title;
        document.getElementById('generic-confirm-message').textContent = message;
        const yes = document.getElementById('generic-confirm-yes');
        const no  = document.getElementById('generic-confirm-no');
        const newYes = yes.cloneNode(true); const newNo = no.cloneNode(true);
        yes.parentNode.replaceChild(newYes, yes); no.parentNode.replaceChild(newNo, no);
        const close = () => { overlay.style.display = 'none'; };
        newYes.addEventListener('click', () => { close(); onConfirm(); });
        newNo.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); }, { once: true });
        overlay.style.display = 'flex';
    }

    // ===============================
    // WorkoutParser
    // ===============================
    class WorkoutParser {
        static MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

        static parse(raw) {
            if (!raw || typeof raw !== 'string') throw new Error('Empty paste');
            const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length < 2) throw new Error('Need at least a name and a date line');

            const workout_type = lines[0];
            const { date, start_time_str } = this._parseDateLine(lines[1]);
            const exercises = [];
            let current = null;

            for (let i = 2; i < lines.length; i++) {
                const line = lines[i];
                if (/^set\s+\d+/i.test(line)) {
                    if (!current) { current = { name: 'Unknown Exercise', sets: [] }; exercises.push(current); }
                    const set = this._parseSetLine(line);
                    if (set) current.sets.push(set);
                } else {
                    current = { name: line, sets: [] };
                    exercises.push(current);
                }
            }

            const cleaned = exercises.filter(ex => ex.name && (ex.sets.length > 0 || /[a-zA-Z]/.test(ex.name)));
            return { date, workout_type, start_time_str, exercises: cleaned, duration_minutes: null };
        }

        static _parseDateLine(line) {
            const today = new Date();
            let date = toDateStr(today), start_time_str = null;
            const m = line.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s+at\s+([\d:apm\s]+))?/i);
            if (m) {
                const monKey = m[1].slice(0,3).toLowerCase();
                const day = parseInt(m[2],10), year = parseInt(m[3],10);
                const month = this.MONTHS[monKey];
                if (month != null && day > 0 && year > 2000) date = toDateStr(new Date(year, month, day));
                if (m[4]) start_time_str = m[4].trim();
            }
            return { date, start_time_str };
        }

        static _parseSetLine(line) {
            const rest = line.replace(/^set\s+\d+\s*:\s*/i, '').trim();
            if (!rest) return null;
            const out = { reps: null, weight_kg: null, distance_mi: null, duration_min: null };
            const wMatch = rest.match(/([\d.]+)\s*kg\b/i); if (wMatch) out.weight_kg = parseFloat(wMatch[1]);
            const dMatch = rest.match(/([\d.]+)\s*mi\b/i); if (dMatch) out.distance_mi = parseFloat(dMatch[1]);
            const dkmMatch = rest.match(/([\d.]+)\s*km\b/i); if (dkmMatch) out.distance_km = parseFloat(dkmMatch[1]);
            const durMatch = rest.match(/([\d.]+)\s*m\b(?!i)/i); if (durMatch) out.duration_min = parseFloat(durMatch[1]);
            const rMatch = rest.match(/(\d+)\s*reps?\b/i) || rest.match(/[x×]\s*(\d+)/i);
            if (rMatch) out.reps = parseInt(rMatch[1], 10);
            if (out.reps == null && out.weight_kg == null && out.distance_mi == null && out.duration_min == null) {
                const bare = rest.match(/^(\d+)$/); if (bare) out.reps = parseInt(bare[1],10);
            }
            return out;
        }

        static summarize(parsed) {
            const totalSets = parsed.exercises.reduce((s, ex) => s + ex.sets.length, 0);
            const totalVolumeKg = parsed.exercises.reduce((sum, ex) =>
                sum + ex.sets.reduce((s, set) => (set.weight_kg && set.reps ? s + set.weight_kg * set.reps : s), 0), 0);
            return { exerciseCount: parsed.exercises.length, totalSets, totalVolumeKg: Math.round(totalVolumeKg) };
        }
    }

    // ===============================
    // WorkoutTracker
    // ===============================
    class WorkoutTracker {
        constructor() {
            this.workouts = [];
            this.progressionChart = null;
            this.pendingParsed = null;
            this.pendingRawText = '';
            this.initialized = false;
        }

        async init() {
            if (this.initialized) return;
            this.initialized = true;
            this.setupEventListeners();
            await this.loadWorkouts();
            this.renderAll();
        }

        setupEventListeners() {
            const qs = id => document.getElementById(id);
            qs('workout-parse-btn')?.addEventListener('click', () => this.handleParse());
            qs('workout-clear-paste-btn')?.addEventListener('click', () => {
                const ta = qs('workout-paste'); if (ta) ta.value = '';
                this.hidePreview();
            });
            qs('workout-save-btn')?.addEventListener('click', () => this.handleSave());
            qs('workout-cancel-btn')?.addEventListener('click', () => this.hidePreview());
            qs('workout-exercise-select')?.addEventListener('change', e => this.renderProgressionChart(e.target.value));
        }

        handleParse() {
            const raw = document.getElementById('workout-paste')?.value || '';
            if (!raw.trim()) { showNotification('Paste a workout first', 'error'); return; }
            try {
                const parsed = WorkoutParser.parse(raw);
                this.pendingParsed = parsed;
                this.pendingRawText = raw;
                this.renderPreview(parsed);
            } catch (err) { showNotification('Could not parse: ' + err.message, 'error'); }
        }

        renderPreview(parsed) {
            const card = document.getElementById('workout-preview');
            if (!card) return;
            const summary = WorkoutParser.summarize(parsed);
            document.getElementById('workout-preview-type').textContent = parsed.workout_type;
            document.getElementById('workout-preview-date').textContent = parsed.date;
            document.getElementById('workout-preview-duration').textContent =
                parsed.duration_minutes ? `${parsed.duration_minutes} min`
                : `${summary.exerciseCount} exercises · ${summary.totalSets} sets · ${summary.totalVolumeKg}kg volume`;

            const exList = document.getElementById('workout-preview-exercises');
            if (exList) {
                exList.innerHTML = parsed.exercises.map(ex => `
                    <div class="workout-exercise-block">
                        <div class="workout-exercise-name">${escapeHtml(ex.name)}</div>
                        <div class="workout-sets">
                            ${ex.sets.map((s, i) => `
                                <div class="workout-set-row">
                                    <span class="workout-set-num">Set ${i+1}</span>
                                    <span class="workout-set-detail">${this.formatSet(s)}</span>
                                </div>`).join('') || '<div class="workout-set-row"><span class="workout-set-detail">No sets</span></div>'}
                        </div>
                    </div>`).join('');
            }
            card.style.display = 'block';
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        hidePreview() {
            const card = document.getElementById('workout-preview');
            if (card) card.style.display = 'none';
            this.pendingParsed = null; this.pendingRawText = '';
        }

        formatSet(s) {
            const parts = [];
            if (s.weight_kg != null)    parts.push(`${s.weight_kg}kg`);
            if (s.reps != null)         parts.push(`${s.reps} reps`);
            if (s.distance_mi != null)  parts.push(`${s.distance_mi} mi`);
            if (s.distance_km != null)  parts.push(`${s.distance_km} km`);
            if (s.duration_min != null) parts.push(`${s.duration_min} min`);
            return parts.join(' · ') || '—';
        }

        async handleSave() {
            if (!this.pendingParsed) return;
            const durationMin = this.pendingParsed.duration_minutes || 60;
            const payload = {
                date: this.pendingParsed.date,
                workout_type: this.pendingParsed.workout_type,
                start_time_str: this.pendingParsed.start_time_str,
                raw_text: this.pendingRawText,
                exercises: this.pendingParsed.exercises,
                duration_minutes: durationMin
            };
            try {
                await window.API.addWorkout(payload);
                await this.createTimeLogForWorkout(payload, durationMin);
                this.hidePreview();
                const ta = document.getElementById('workout-paste'); if (ta) ta.value = '';
                await this.loadWorkouts();
                this.renderAll();
                if (window.timeTracker && window.timeTracker.initialized) {
                    await window.timeTracker.loadLogs();
                    window.timeTracker.renderAll();
                }
                showNotification(`🏋 Saved: ${payload.workout_type} (${durationMin} min logged to Health)`);
            } catch (err) { showNotification('Error saving: ' + err.message, 'error'); }
        }

        async createTimeLogForWorkout(workout, durationMin) {
            let startDate;
            if (workout.start_time_str) {
                const parsedStart = this._parseHevyTime(workout.date, workout.start_time_str);
                if (parsedStart) startDate = parsedStart;
            }
            if (!startDate) startDate = new Date(`${workout.date}T17:00:00`);
            const endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);
            const payload = {
                activity: workout.workout_type, category: 'Health',
                start_time: startDate.toISOString(), end_time: endDate.toISOString(),
                duration_seconds: durationMin * 60, date: workout.date, notes: 'Auto-logged from workout'
            };
            try { await window.API.addTimeLog(payload); } catch (err) { console.warn('Auto-timelog failed:', err); }
        }

        _parseHevyTime(dateStr, timeStr) {
            const m = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
            if (!m) return null;
            let h = parseInt(m[1],10); const min = m[2] ? parseInt(m[2],10) : 0;
            const ampm = (m[3]||'').toLowerCase();
            if (ampm === 'pm' && h < 12) h += 12;
            if (ampm === 'am' && h === 12) h = 0;
            const [y, mo, d] = dateStr.split('-').map(Number);
            return new Date(y, mo-1, d, h, min, 0, 0);
        }

        async loadWorkouts() {
            try { this.workouts = await window.API.getWorkouts() || []; }
            catch (err) { console.error('loadWorkouts failed', err); this.workouts = []; }
        }

        renderAll() {
            this.renderWeeklyStats();
            this.renderExerciseDropdown();
            this.renderHistory();
            const sel = document.getElementById('workout-exercise-select');
            if (sel && sel.value) this.renderProgressionChart(sel.value);
        }

        renderWeeklyStats() {
            const today = new Date();
            const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 6);
            const weekly = this.workouts.filter(w => w.date >= toDateStr(weekAgo) && w.date <= toDateStr(today)).length;
            const countEl = document.getElementById('workout-weekly-count');
            if (countEl) countEl.textContent = String(weekly);

            const byDate = new Set(this.workouts.map(w => w.date));
            let streak = 0; const cur = new Date(today);
            if (!byDate.has(toDateStr(cur))) cur.setDate(cur.getDate() - 1);
            while (byDate.has(toDateStr(cur))) { streak++; cur.setDate(cur.getDate() - 1); }
            const streakEl = document.getElementById('workout-streak');
            if (streakEl) streakEl.textContent = `${streak} Days`;
        }

        renderExerciseDropdown() {
            const sel = document.getElementById('workout-exercise-select');
            if (!sel) return;
            const prev = sel.value;
            const names = new Set();
            this.workouts.forEach(w => (w.exercises || []).forEach(ex => { if (ex.name) names.add(ex.name); }));
            const sorted = [...names].sort((a, b) => a.localeCompare(b));
            sel.innerHTML = '<option value="">— Select an exercise —</option>' +
                sorted.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
            if (prev && sorted.includes(prev)) sel.value = prev;
        }

        renderHistory() {
            const list = document.getElementById('workout-history-list');
            if (!list) return;
            if (!this.workouts.length) { list.innerHTML = '<div class="loading">No workouts yet. Paste one above to get started.</div>'; return; }
            list.innerHTML = this.workouts.map(w => {
                const exCount = (w.exercises || []).length;
                const totalVolume = (w.exercises || []).reduce((sum, ex) =>
                    sum + (ex.sets || []).reduce((s, set) => (set.weight_kg && set.reps ? s + set.weight_kg * set.reps : s), 0), 0);
                const volStr = totalVolume > 0 ? `${Math.round(totalVolume)}kg volume` : '—';
                const dur = w.duration_minutes ? `${w.duration_minutes} min` : '';
                return `<div class="transaction-item workout-item" data-id="${w.id}">
                    <div class="transaction-content">
                        <div class="transaction-details">
                            <strong>🏋 ${escapeHtml(w.workout_type)}</strong>
                            <small>${w.date} · ${exCount} exercises · ${escapeHtml(volStr)}${dur ? ' · ' + dur : ''}</small>
                        </div>
                        <div class="transaction-right">
                            <div class="transaction-actions">
                                <button class="tx-action-btn delete-btn" data-id="${w.id}"
                                        onclick="window.workoutTracker.confirmDelete(this.dataset.id)"
                                        title="Delete">🗑️</button>
                            </div>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        confirmDelete(id) {
            showGenericConfirm('Delete Workout?', 'This workout will be permanently removed.', () => this.deleteWorkout(id));
        }

        async deleteWorkout(id) {
            try {
                await window.API.deleteWorkout(id);
                await this.loadWorkouts(); this.renderAll();
                showNotification('Workout deleted.');
            } catch (err) { showNotification('Error deleting: ' + err.message, 'error'); }
        }

        renderProgressionChart(exerciseName) {
            const canvas = document.getElementById('workout-progression-chart');
            if (!canvas || typeof Chart === 'undefined') return;
            if (this.progressionChart) { this.progressionChart.destroy(); this.progressionChart = null; }
            if (!exerciseName) return;

            const points = [];
            this.workouts.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(w => {
                (w.exercises || []).forEach(ex => {
                    if (ex.name === exerciseName) {
                        const weights = (ex.sets || []).map(s => Number(s.weight_kg) || 0);
                        const maxW = weights.length ? Math.max(...weights) : 0;
                        if (maxW > 0) points.push({ date: w.date, weight: maxW });
                    }
                });
            });

            if (!points.length) { showNotification('No weight data for this exercise yet.', 'error'); return; }

            this.progressionChart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: points.map(p => p.date),
                    datasets: [{
                        label: `Max Weight (kg) — ${exerciseName}`,
                        data: points.map(p => p.weight),
                        borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,0.12)',
                        fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#00d4aa'
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'top' } },
                    scales: { y: { beginAtZero: false, title: { display: true, text: 'kg' } } }
                }
            });
        }

        getWorkouts() { return this.workouts; }
    }

    window.WorkoutParser   = WorkoutParser;
    window.WorkoutTracker  = WorkoutTracker;
    window.workoutTracker  = new WorkoutTracker();
})();