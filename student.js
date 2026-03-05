document.addEventListener('DOMContentLoaded', async () => {
    const sb = window.supabaseClient;
    const guard = document.getElementById('auth-guard');
    if (!sb) { if (guard) guard.remove(); return; }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.replace('login.html'); return; }
    const uid = session.user.id;

    const { data: profile } = await sb.from('profiles').select('role, display_name, class_code, created_at').eq('id', uid).single();
    if (!profile || profile.role !== 'student') { window.location.replace('index.html'); return; }
    if (guard) guard.remove();

    const KEY_SESS = 'ihbb_v2_sessions';
    const SESSION_SYNC_TABLE = 'user_drill_sessions';
    const DAY_MS = 24 * 60 * 60 * 1000;
    let userEmail = String(session.user?.email || '').trim();
    const ERA_LABELS = {
        "01": "8000 BCE – 600 BCE",
        "02": "600 BCE – 600 CE",
        "03": "600 CE – 1450 CE",
        "04": "1450 CE – 1750 CE",
        "05": "1750 – 1914",
        "06": "1914 – 1991",
        "07": "1991 – Present"
    };
    const formatRole = (role) => {
        const s = String(role || '').trim().toLowerCase();
        if (!s) return 'Unknown';
        return s.charAt(0).toUpperCase() + s.slice(1);
    };
    const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
    const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

    // ========== NAME CHECK ==========
    if (!profile.display_name || !profile.display_name.trim()) {
        document.getElementById('name-modal').classList.remove('hidden');
    }

    document.getElementById('btn-save-name').addEventListener('click', async () => {
        const name = document.getElementById('modal-name').value.trim();
        if (!name) { showAlert('Please enter your name.', 'error'); return; }
        const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', uid);
        if (error) { showAlert('Failed to save name: ' + error.message, 'error'); return; }
        profile.display_name = name;
        renderAccountProfile();
        document.getElementById('name-modal').classList.add('hidden');
        showAlert('Name saved!', 'success');
    });

    // ========== TAB SWITCHING ==========
    document.querySelectorAll('.dash-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.view').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const tabId = 'tab-' + tab.dataset.tab;
            document.getElementById(tabId).classList.add('active');
            if (tab.dataset.tab === 'analytics') {
                loadAnalytics();
            }
        });
    });

    // ========== LOGOUT ==========
    document.getElementById('btn-logout').addEventListener('click', async (e) => {
        e.preventDefault(); await sb.auth.signOut(); window.location.replace('login.html');
    });

    // ========== ACCOUNT TAB ==========
    const deleteBtn = document.getElementById('btn-delete-account');
    const saveAccountBtn = document.getElementById('btn-save-account');
    const revealDeleteBtn = document.getElementById('btn-reveal-delete');
    const dangerPanel = document.getElementById('account-danger-panel');
    const confirmDeleteReveal = document.getElementById('confirm-delete-reveal');

    function setInput(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = value ?? '';
    }

    function renderAccountProfile() {
        setInput('acc-display-name', profile.display_name || 'Unnamed');
        setInput('acc-role', formatRole(profile.role));
        setInput('acc-email', userEmail || '');
        setInput('acc-class-code', profile.class_code || '—');
        setInput('acc-created-at', profile.created_at ? new Date(profile.created_at).toLocaleString() : '—');
        setInput('acc-user-id', uid);
    }

    renderAccountProfile();

    saveAccountBtn?.addEventListener('click', async () => {
        const nameInput = document.getElementById('acc-display-name');
        const emailInput = document.getElementById('acc-email');
        if (!nameInput || !emailInput) return;

        const nextName = String(nameInput.value || '').trim();
        const nextEmail = normalizeEmail(emailInput.value);
        if (!nextName) {
            showAlert('Display name cannot be empty.', 'error');
            nameInput.focus();
            return;
        }
        if (!nextEmail || !isValidEmail(nextEmail)) {
            showAlert('Please enter a valid email address.', 'error');
            emailInput.focus();
            return;
        }

        const prevName = String(profile.display_name || '').trim();
        const prevEmail = normalizeEmail(userEmail);
        const changeName = nextName !== prevName;
        const changeEmail = nextEmail !== prevEmail;
        if (!changeName && !changeEmail) {
            showAlert('No profile changes to save.', 'success');
            return;
        }

        saveAccountBtn.disabled = true;
        const originalText = saveAccountBtn.textContent;
        saveAccountBtn.textContent = 'Saving...';

        try {
            const successMsgs = [];
            const errorMsgs = [];

            if (changeName) {
                const { error } = await sb.from('profiles').update({ display_name: nextName }).eq('id', uid);
                if (error) errorMsgs.push(`Name update failed: ${error.message}`);
                else {
                    profile.display_name = nextName;
                    successMsgs.push('Display name updated');
                }
            }

            if (changeEmail) {
                const { data, error } = await sb.auth.updateUser({ email: nextEmail });
                if (error) errorMsgs.push(`Email update failed: ${error.message}`);
                else {
                    userEmail = String(data?.user?.email || data?.user?.new_email || nextEmail).trim();
                    successMsgs.push('Email change saved');
                }
            }

            renderAccountProfile();
            if (successMsgs.length && !errorMsgs.length) {
                const emailNote = changeEmail ? ' Check your inbox if verification is required.' : '';
                showAlert(`${successMsgs.join('. ')}.${emailNote}`, 'success');
            } else if (successMsgs.length && errorMsgs.length) {
                showAlert(`${successMsgs.join('. ')}. ${errorMsgs.join(' ')}`, 'error');
            } else if (errorMsgs.length) {
                showAlert(errorMsgs.join(' '), 'error');
            }
        } catch (err) {
            showAlert(`Failed to save account changes: ${err?.message || err}`, 'error');
        } finally {
            saveAccountBtn.disabled = false;
            saveAccountBtn.textContent = originalText;
        }
    });

    revealDeleteBtn?.addEventListener('click', () => {
        if (!dangerPanel) return;
        const show = dangerPanel.classList.contains('hidden');
        dangerPanel.classList.toggle('hidden', !show);
        revealDeleteBtn.textContent = show ? 'Hide Delete Option' : 'Show Delete Option';
        if (!show && confirmDeleteReveal) {
            confirmDeleteReveal.checked = false;
            if (deleteBtn) deleteBtn.disabled = true;
        }
    });

    confirmDeleteReveal?.addEventListener('change', () => {
        if (deleteBtn) deleteBtn.disabled = !confirmDeleteReveal.checked;
    });

    // ========== DELETE ACCOUNT ==========
    deleteBtn?.addEventListener('click', async () => {
        if (!confirm('⚠️ Permanently delete your account and ALL data?')) return;
        if (!confirm('FINAL WARNING: This cannot be undone!')) return;
        try { await sb.rpc('delete_user'); await sb.auth.signOut(); window.location.replace('login.html'); }
        catch (e) { alert('Delete failed: ' + e.message); }
    });

    // ========== CLASSES ==========
    async function loadClasses() {
        const { data } = await sb.from('class_students').select('class_id, classes(id, name, code)').eq('student_id', uid);
        renderClasses(data || []);
    }

    function renderClasses(list) {
        const el = document.getElementById('student-classes');
        if (!list.length) { el.innerHTML = '<p class="muted">You haven\'t joined any classes yet. Enter a code above!</p>'; return; }
        el.innerHTML = list.map(cs => {
            const c = cs.classes;
            return `<div class="list-item">
                <span class="item-title">${esc(c.name)}</span>
                <span class="item-badge">${c.code}</span>
                <button class="btn bad" onclick="leaveClass('${cs.class_id}')">Leave</button>
            </div>`;
        }).join('');
    }

    document.getElementById('btn-join').addEventListener('click', async () => {
        const code = document.getElementById('join-code').value.trim().toUpperCase();
        if (!code) return;
        // Name is required before joining
        if (!profile.display_name || !profile.display_name.trim()) {
            document.getElementById('name-modal').classList.remove('hidden');
            return;
        }
        const { data: cls } = await sb.from('classes').select('id').eq('code', code).single();
        if (!cls) { showAlert('Class not found. Check the code.', 'error'); return; }
        const { error } = await sb.from('class_students').insert({ class_id: cls.id, student_id: uid });
        if (error) {
            if (error.code === '23505') showAlert('You already joined this class!', 'error');
            else showAlert(error.message, 'error');
            return;
        }
        document.getElementById('join-code').value = '';
        showAlert('Joined class!', 'success');
        loadClasses();
        loadAssignments();
    });

    window.leaveClass = async (classId) => {
        if (!confirm('Leave this class?')) return;
        await sb.from('class_students').delete().eq('class_id', classId).eq('student_id', uid);
        loadClasses(); loadAssignments();
    };

    // ========== ASSIGNMENT SUB-TABS ==========
    document.querySelectorAll('.assign-sub-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.assign-sub-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.assign-panel').forEach(p => p.classList.add('hidden'));
            tab.classList.add('active');
            document.getElementById('assign-' + tab.dataset.sub).classList.remove('hidden');
        });
    });

    // ========== ASSIGNMENTS ==========
    async function loadAssignments() {
        const { data: memberships } = await sb.from('class_students').select('class_id').eq('student_id', uid);
        if (!memberships || !memberships.length) {
            document.getElementById('student-assignments-todo').innerHTML = '<p class="muted">Join a class to see assignments.</p>';
            document.getElementById('student-assignments-completed').innerHTML = '<p class="muted">No completed assignments.</p>';
            return;
        }
        const classIds = memberships.map(m => m.class_id);
        const { data: assignments } = await sb.from('assignments').select('*, classes(name)').in('class_id', classIds).order('due_date', { ascending: true });

        const { data: subs } = await sb.from('assignment_submissions').select('assignment_id, correct, total').eq('student_id', uid);
        const subMap = {};
        (subs || []).forEach(s => subMap[s.assignment_id] = s);

        renderAssignments(assignments || [], subMap);
    }

    function renderAssignments(list, subMap) {
        const todoEl = document.getElementById('student-assignments-todo');
        const doneEl = document.getElementById('student-assignments-completed');

        const todoList = list.filter(a => !subMap[a.id]);
        const doneList = list.filter(a => subMap[a.id]);

        // Render To Do
        if (!todoList.length) {
            todoEl.innerHTML = '<p class="muted">🎉 All caught up! No pending assignments.</p>';
        } else {
            todoEl.innerHTML = todoList.map(a => {
                const due = a.due_date ? new Date(a.due_date).toLocaleDateString() : 'No deadline';
                const cls = a.classes?.name || '';
                return `<div class="list-item">
                    <span class="item-title">${esc(a.title)}</span>
                    <span class="item-meta">${esc(cls)} · Due: ${due}</span>
                    <button class="btn pri" onclick="startAssignment('${a.id}', '${esc(a.title)}')">🎯 Start</button>
                </div>`;
            }).join('');
        }

        // Render Completed
        if (!doneList.length) {
            doneEl.innerHTML = '<p class="muted">No completed assignments yet.</p>';
        } else {
            doneEl.innerHTML = doneList.map(a => {
                const due = a.due_date ? new Date(a.due_date).toLocaleDateString() : 'No deadline';
                const cls = a.classes?.name || '';
                const sub = subMap[a.id];
                const pct = sub.total ? Math.round(sub.correct / sub.total * 100) : 0;
                return `<div class="list-item">
                    <span class="item-title">${esc(a.title)}</span>
                    <span class="item-meta">${esc(cls)} · Due: ${due}</span>
                    <span class="item-score ${pct >= 50 ? 'good' : 'bad'}">${sub.correct}/${sub.total} (${pct}%)</span>
                    <button class="btn ghost" onclick="startAssignment('${a.id}', '${esc(a.title)}')">🔄 Redo</button>
                </div>`;
            }).join('');
        }

        // Update sub-tab labels with counts
        document.querySelectorAll('.assign-sub-tab').forEach(t => {
            if (t.dataset.sub === 'todo') t.textContent = `📋 To Do (${todoList.length})`;
            if (t.dataset.sub === 'completed') t.textContent = `✅ Completed (${doneList.length})`;
        });
    }

    // ========== START ASSIGNMENT → PRACTICE HUB ==========
    window.startAssignment = async (assignId, title) => {
        // Fetch assignment questions from Supabase
        const { data: questions } = await sb.from('assignment_questions').select('*').eq('assignment_id', assignId);
        if (!questions || !questions.length) { showAlert('No questions in this assignment.', 'error'); return; }

        // Store in localStorage for the practice hub to pick up
        const storageKey = 'ihbb_assignment_' + assignId;
        localStorage.setItem(storageKey, JSON.stringify({ title, questions }));

        // Redirect to practice hub with assignment param
        window.location.href = 'index.html?drill=1&assignment=' + assignId;
    };

    // ========== ANALYTICS ==========
    document.getElementById('btn-analytics-refresh')?.addEventListener('click', loadAnalytics);

    function safeReadJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed ?? fallback;
        } catch {
            return fallback;
        }
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function dayKeyFromDate(d) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    function dayKeyFromTs(ts) {
        const d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        return dayKeyFromDate(d);
    }

    function buildLast30Days() {
        const out = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 29; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            out.push({
                key: dayKeyFromDate(d),
                label: `${d.getMonth() + 1}/${d.getDate()}`,
                date: d,
                attempts: 0,
                correct: 0,
                sessions: 0,
                buzzSum: 0,
                buzzN: 0,
                accuracy: null,
                avgBuzz: null
            });
        }
        return out;
    }

    function normalizeRegion(region) {
        const r = String(region || '').trim();
        return r || 'Unknown Region';
    }

    function normalizeEra(era) {
        const raw = String(era || '').trim();
        if (!raw) return 'Unknown Era';
        const maybeCode = raw.length === 1 ? `0${raw}` : raw;
        return ERA_LABELS[maybeCode] || ERA_LABELS[raw] || raw;
    }

    let analyticsCloudReady = true;
    let analyticsCloudWarned = false;

    function isCloudAnalyticsSetupIssue(err) {
        const code = String(err?.code || '');
        const msg = String(err?.message || '').toLowerCase();
        return (
            code === '42P01' || code === 'PGRST205' || code === 'PGRST204' ||
            msg.includes('does not exist') ||
            msg.includes('permission denied') ||
            msg.includes('policy')
        );
    }

    function normalizeSessionForAnalytics(raw) {
        const ts = Number(raw?.ts) || (raw?.created_at ? new Date(raw.created_at).getTime() : 0);
        const items = Array.isArray(raw?.items) ? raw.items : [];
        const results = Array.isArray(raw?.results) ? raw.results : [];
        const buzz = Array.isArray(raw?.buzz) ? raw.buzz : [];
        const meta = Array.isArray(raw?.meta) ? raw.meta : [];
        return {
            ts,
            total: Number(raw?.total) || 0,
            correct: Number(raw?.correct) || 0,
            dur: Number(raw?.dur) || 0,
            items,
            results,
            buzz,
            meta
        };
    }

    async function fetchAnalyticsSessionsFromCloud() {
        const cutoff = Date.now() - (30 * DAY_MS);
        const { data, error } = await sb
            .from(SESSION_SYNC_TABLE)
            .select('ts, total, correct, dur, buzz, items, results, meta, created_at')
            .eq('user_id', uid)
            .gte('ts', cutoff)
            .order('ts', { ascending: true });
        if (error) throw error;
        return (Array.isArray(data) ? data : []).map(normalizeSessionForAnalytics);
    }

    function addDimStat(map, name, isCorrect, buzzValue) {
        if (!map[name]) {
            map[name] = { name, attempts: 0, correct: 0, buzzSum: 0, buzzN: 0 };
        }
        map[name].attempts++;
        if (isCorrect) map[name].correct++;
        if (Number.isFinite(buzzValue) && buzzValue > 0) {
            map[name].buzzSum += buzzValue;
            map[name].buzzN++;
        }
    }

    function finalizeDimStats(mapObj) {
        return Object.values(mapObj).map(s => ({
            name: s.name,
            attempts: s.attempts,
            correct: s.correct,
            accuracy: s.attempts ? Math.round((s.correct / s.attempts) * 100) : 0,
            avgBuzz: s.buzzN ? (s.buzzSum / s.buzzN) : null
        })).sort((a, b) => b.attempts - a.attempts || a.name.localeCompare(b.name));
    }

    function summarizeWindow(days) {
        const attempts = days.reduce((sum, d) => sum + d.attempts, 0);
        const correct = days.reduce((sum, d) => sum + d.correct, 0);
        const buzzSum = days.reduce((sum, d) => sum + d.buzzSum, 0);
        const buzzN = days.reduce((sum, d) => sum + d.buzzN, 0);
        return {
            attempts,
            accuracy: attempts ? (correct / attempts * 100) : null,
            avgBuzz: buzzN ? (buzzSum / buzzN) : null
        };
    }

    function computeAnalyticsSnapshot(sessionsRaw) {
        const cutoff = Date.now() - (30 * DAY_MS);
        const sessions = (Array.isArray(sessionsRaw) ? sessionsRaw : [])
            .map(normalizeSessionForAnalytics)
            .filter(s => Number(s.ts) >= cutoff)
            .sort((a, b) => Number(a.ts) - Number(b.ts));
        const days = buildLast30Days();
        const dayMap = new Map(days.map(d => [d.key, d]));
        const eraAgg = {};
        const regionAgg = {};

        let totalAttempts = 0;
        let totalCorrect = 0;
        let totalBuzzSum = 0;
        let totalBuzzN = 0;
        let fastestBuzz = null;

        for (const s of sessions) {
            const total = Number(s.total) || 0;
            const correct = Number(s.correct) || 0;
            const day = dayMap.get(dayKeyFromTs(s.ts));

            totalAttempts += total;
            totalCorrect += correct;
            if (day) {
                day.sessions += 1;
                day.attempts += total;
                day.correct += correct;
            }

            const buzz = Array.isArray(s.buzz) ? s.buzz : [];
            for (const tRaw of buzz) {
                const t = Number(tRaw);
                if (!Number.isFinite(t) || t <= 0) continue;
                totalBuzzSum += t;
                totalBuzzN += 1;
                if (day) {
                    day.buzzSum += t;
                    day.buzzN += 1;
                }
                if (fastestBuzz === null || t < fastestBuzz) fastestBuzz = t;
            }

            const ids = Array.isArray(s.items) ? s.items : [];
            const results = Array.isArray(s.results) ? s.results : [];
            if (!ids.length || !results.length) continue;
            const maxLen = Math.min(ids.length, results.length);
            for (let i = 0; i < maxLen; i++) {
                const fromSession = Array.isArray(s.meta) ? s.meta[i] : null;
                const category = normalizeRegion(fromSession?.category || '');
                const era = normalizeEra(fromSession?.era || '');
                const isCorrect = !!results[i];
                const buzzValue = Number(buzz[i]);
                addDimStat(regionAgg, category, isCorrect, buzzValue);
                addDimStat(eraAgg, era, isCorrect, buzzValue);
            }
        }

        for (const d of days) {
            d.accuracy = d.attempts ? Math.round((d.correct / d.attempts) * 100) : null;
            d.avgBuzz = d.buzzN ? (d.buzzSum / d.buzzN) : null;
        }

        const eraStats = finalizeDimStats(eraAgg);
        const regionStats = finalizeDimStats(regionAgg);
        const combined = [
            ...eraStats.map(s => ({ ...s, dim: 'Era' })),
            ...regionStats.map(s => ({ ...s, dim: 'Region' }))
        ];
        const blindSpots = combined
            .filter(s => s.attempts >= 4)
            .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
            .slice(0, 6);

        const last7 = summarizeWindow(days.slice(-7));
        const prev7 = summarizeWindow(days.slice(-14, -7));

        return {
            days,
            sessionsCount: sessions.length,
            totalAttempts,
            totalCorrect,
            totalAccuracy: totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
            avgBuzz: totalBuzzN ? (totalBuzzSum / totalBuzzN) : null,
            fastestBuzz,
            activeDays: days.filter(d => d.attempts > 0).length,
            accDelta7d: (last7.accuracy === null || prev7.accuracy === null) ? null : (last7.accuracy - prev7.accuracy),
            buzzDelta7d: (last7.avgBuzz === null || prev7.avgBuzz === null) ? null : (last7.avgBuzz - prev7.avgBuzz),
            eraStats,
            regionStats,
            blindSpots
        };
    }

    function svgEmpty(text) {
        return `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="currentColor" opacity=".55">${esc(text)}</text>`;
    }

    function renderLineChart(svgId, points, labels, options = {}) {
        const svg = document.getElementById(svgId);
        if (!svg) return;

        const numeric = points.map(v => Number.isFinite(v) ? Number(v) : null);
        const valid = numeric.filter(v => v !== null);
        if (!valid.length) {
            svg.innerHTML = svgEmpty(options.emptyText || 'No data yet');
            return;
        }

        const w = 720, h = 220;
        const pad = { l: 42, r: 16, t: 16, b: 32 };
        const plotW = w - pad.l - pad.r;
        const plotH = h - pad.t - pad.b;
        const min = Number.isFinite(options.min) ? Number(options.min) : Math.min(...valid);
        const max = Number.isFinite(options.max) ? Number(options.max) : Math.max(...valid);
        const yMin = options.minZero ? Math.min(0, min) : min;
        const yMax = max === yMin ? yMin + 1 : max;

        const xFor = i => pad.l + (numeric.length <= 1 ? 0 : (i * plotW / (numeric.length - 1)));
        const yFor = v => pad.t + ((yMax - v) * plotH / (yMax - yMin));

        const gridTicks = 4;
        const grids = [];
        const yLabels = [];
        for (let t = 0; t <= gridTicks; t++) {
            const ratio = t / gridTicks;
            const y = pad.t + ratio * plotH;
            const value = yMax - ((yMax - yMin) * ratio);
            const text = options.yLabelFn ? options.yLabelFn(value) : String(Math.round(value));
            grids.push(`<line x1="${pad.l}" y1="${y.toFixed(2)}" x2="${w - pad.r}" y2="${y.toFixed(2)}" stroke="rgba(148,163,184,0.18)" stroke-width="1" />`);
            yLabels.push(`<text x="${pad.l - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="currentColor" opacity=".6" font-size="11">${esc(text)}</text>`);
        }

        let path = '';
        let open = false;
        const circles = [];
        numeric.forEach((v, i) => {
            if (v === null) {
                open = false;
                return;
            }
            const x = xFor(i);
            const y = yFor(v);
            path += open ? ` L ${x.toFixed(2)} ${y.toFixed(2)}` : ` M ${x.toFixed(2)} ${y.toFixed(2)}`;
            open = true;
            circles.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.2" fill="${options.color || 'var(--accent)'}" />`);
        });

        const mid = Math.floor((labels.length - 1) / 2);
        const xLabels = [
            { i: 0, txt: labels[0] || '' },
            { i: mid, txt: labels[mid] || '' },
            { i: labels.length - 1, txt: labels[labels.length - 1] || '' }
        ].map(xl => `<text x="${xFor(xl.i).toFixed(2)}" y="${h - 8}" text-anchor="middle" fill="currentColor" opacity=".7" font-size="11">${esc(xl.txt)}</text>`);

        svg.innerHTML = `
            <rect x="0" y="0" width="${w}" height="${h}" fill="transparent"></rect>
            ${grids.join('')}
            ${yLabels.join('')}
            <path d="${path}" fill="none" stroke="${options.color || 'var(--accent)'}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"></path>
            ${circles.join('')}
            ${xLabels.join('')}
        `;
    }

    function renderBarChart(svgId, values, labels, options = {}) {
        const svg = document.getElementById(svgId);
        if (!svg) return;
        const vals = values.map(v => Number(v) || 0);
        const max = Math.max(...vals, 0);
        if (max <= 0) {
            svg.innerHTML = svgEmpty(options.emptyText || 'No data yet');
            return;
        }

        const w = 720, h = 220;
        const pad = { l: 20, r: 12, t: 16, b: 32 };
        const plotW = w - pad.l - pad.r;
        const plotH = h - pad.t - pad.b;
        const bw = Math.max(3, plotW / vals.length * 0.72);
        const gap = Math.max(1, plotW / vals.length * 0.28);

        const bars = vals.map((v, i) => {
            const x = pad.l + i * (bw + gap);
            const hh = Math.max(2, (v / max) * plotH);
            const y = h - pad.b - hh;
            return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${hh.toFixed(2)}" rx="5" fill="${options.color || 'var(--accent2)'}" opacity="0.82" />`;
        });

        const mid = Math.floor((labels.length - 1) / 2);
        const xLabelPos = i => pad.l + i * (bw + gap) + (bw / 2);
        const xLabels = [
            { i: 0, txt: labels[0] || '' },
            { i: mid, txt: labels[mid] || '' },
            { i: labels.length - 1, txt: labels[labels.length - 1] || '' }
        ].map(xl => `<text x="${xLabelPos(xl.i).toFixed(2)}" y="${h - 8}" text-anchor="middle" fill="currentColor" opacity=".7" font-size="11">${esc(xl.txt)}</text>`);

        svg.innerHTML = `
            <rect x="0" y="0" width="${w}" height="${h}" fill="transparent"></rect>
            ${bars.join('')}
            ${xLabels.join('')}
        `;
    }

    function perfGradient(accuracy) {
        const clamped = Math.max(0, Math.min(100, accuracy));
        const hue = Math.round((clamped / 100) * 120);
        const hue2 = Math.min(140, hue + 18);
        return `linear-gradient(90deg, hsl(${hue}, 78%, 52%), hsl(${hue2}, 78%, 44%))`;
    }

    function renderPerformanceList(elId, stats, emptyText) {
        const el = document.getElementById(elId);
        if (!el) return;
        if (!stats.length) {
            el.innerHTML = `<p class="muted">${esc(emptyText)}</p>`;
            return;
        }
        el.innerHTML = stats.slice(0, 10).map(s => `
            <div class="analytics-perf-row">
                <div class="analytics-perf-top">
                    <div class="analytics-perf-name">${esc(s.name)}</div>
                    <div class="analytics-perf-meta">${s.attempts} q</div>
                </div>
                <div class="analytics-perf-bar">
                    <span class="analytics-perf-fill" style="width:${Math.max(4, s.accuracy)}%; --perf-color:${perfGradient(s.accuracy)};"></span>
                </div>
                <div class="analytics-perf-bottom">
                    <span>${s.accuracy}% accuracy</span>
                    <span>${s.avgBuzz ? `${s.avgBuzz.toFixed(2)}s avg buzz` : 'No buzz speed'}</span>
                </div>
            </div>
        `).join('');
    }

    function renderBlindSpots(list) {
        const el = document.getElementById('analytics-blind-spots');
        if (!el) return;
        if (!list.length) {
            el.innerHTML = '<p class="muted">Not enough answered questions yet to identify blind spots.</p>';
            return;
        }
        el.innerHTML = list.map(s => {
            const severity = s.accuracy < 50 ? 'Critical' : (s.accuracy < 70 ? 'Watch' : 'Improve');
            return `
                <div class="analytics-blind-card">
                    <div class="analytics-blind-head">
                        <div class="analytics-blind-name">${esc(s.name)}</div>
                        <div class="analytics-blind-tag">${severity}</div>
                    </div>
                    <div class="analytics-perf-bottom">
                        <span>${esc(s.dim)} • ${s.attempts} attempts</span>
                        <span>${s.accuracy}% accuracy</span>
                    </div>
                    <div class="analytics-perf-bottom">
                        <span>${s.correct}/${s.attempts} correct</span>
                        <span>${s.avgBuzz ? `${s.avgBuzz.toFixed(2)}s avg buzz` : 'No buzz speed'}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderHeatmap(days, activeDays, fastestBuzz) {
        const wrap = document.getElementById('analytics-heatmap');
        const caption = document.getElementById('analytics-heatmap-caption');
        if (!wrap || !caption) return;

        wrap.innerHTML = days.map(d => {
            let intensity = 0;
            if (d.attempts > 0) {
                if (d.accuracy === null) intensity = 1;
                else if (d.accuracy < 50) intensity = 1;
                else if (d.accuracy < 65) intensity = 2;
                else if (d.accuracy < 80) intensity = 3;
                else intensity = 4;
            }
            const title = `${d.key}: ${d.attempts} q, ${d.accuracy === null ? 'n/a' : d.accuracy + '%'}`;
            return `<div class="analytics-heat-cell analytics-heat-${intensity}" title="${esc(title)}"></div>`;
        }).join('');

        caption.textContent = `Active on ${activeDays}/30 days${fastestBuzz ? ` • Fastest buzz: ${fastestBuzz.toFixed(2)}s` : ''}.`;
    }

    function setDelta(elId, value, unit, higherIsBetter, digits = 1) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.classList.remove('analytics-delta-up', 'analytics-delta-down');
        if (!Number.isFinite(value)) {
            el.textContent = '—';
            return;
        }
        const rounded = digits > 0 ? value.toFixed(digits) : String(Math.round(value));
        const sign = value > 0 ? '+' : '';
        el.textContent = `${sign}${rounded}${unit}`;
        const improved = higherIsBetter ? value >= 0 : value <= 0;
        el.classList.add(improved ? 'analytics-delta-up' : 'analytics-delta-down');
    }

    async function loadAnalytics() {
        let sessionsRaw = [];
        if (analyticsCloudReady) {
            try {
                sessionsRaw = await fetchAnalyticsSessionsFromCloud();
            } catch (err) {
                console.warn('Analytics cloud fetch failed, using local fallback:', err);
                sessionsRaw = safeReadJson(KEY_SESS, []);
                if (isCloudAnalyticsSetupIssue(err)) {
                    analyticsCloudReady = false;
                    if (!analyticsCloudWarned) {
                        analyticsCloudWarned = true;
                        showAlert('Cloud analytics is not set up yet; using local data on this device.', 'error');
                    }
                }
            }
        } else {
            sessionsRaw = safeReadJson(KEY_SESS, []);
        }

        const snapshot = computeAnalyticsSnapshot(sessionsRaw);
        const emptyEl = document.getElementById('analytics-empty');
        const contentEl = document.getElementById('analytics-content');
        const hasData = snapshot.totalAttempts > 0;
        if (emptyEl) emptyEl.classList.toggle('hidden', hasData);
        if (contentEl) contentEl.classList.toggle('hidden', !hasData);
        if (!hasData) return;

        document.getElementById('analytics-kpi-attempts').textContent = snapshot.totalAttempts.toLocaleString();
        document.getElementById('analytics-kpi-accuracy').textContent = `${snapshot.totalAccuracy}%`;
        document.getElementById('analytics-kpi-buzz').textContent = snapshot.avgBuzz ? `${snapshot.avgBuzz.toFixed(2)}s` : '—';
        document.getElementById('analytics-kpi-sessions').textContent = String(snapshot.sessionsCount);
        setDelta('analytics-kpi-acc-delta', snapshot.accDelta7d, '%', true, 1);
        setDelta('analytics-kpi-buzz-delta', snapshot.buzzDelta7d, 's', false, 2);

        const labels = snapshot.days.map(d => d.label);
        renderLineChart(
            'analytics-chart-accuracy',
            snapshot.days.map(d => d.accuracy),
            labels,
            { min: 0, max: 100, color: '#60a5fa', yLabelFn: v => `${Math.round(v)}%`, emptyText: 'No accuracy data' }
        );
        renderLineChart(
            'analytics-chart-buzz',
            snapshot.days.map(d => d.avgBuzz),
            labels,
            { minZero: true, color: '#22c55e', yLabelFn: v => `${v.toFixed(1)}s`, emptyText: 'No buzz speed data' }
        );
        renderBarChart(
            'analytics-chart-volume',
            snapshot.days.map(d => d.attempts),
            labels,
            { color: '#f59e0b', emptyText: 'No attempts yet' }
        );

        renderPerformanceList('analytics-era-list', snapshot.eraStats, 'No era-tagged questions yet.');
        renderPerformanceList('analytics-region-list', snapshot.regionStats, 'No region-tagged questions yet.');
        renderBlindSpots(snapshot.blindSpots);
        renderHeatmap(snapshot.days, snapshot.activeDays, snapshot.fastestBuzz);
    }

    // ========== HELPERS ==========
    function showAlert(msg, type = 'error') {
        const el = document.getElementById('alert-box');
        el.textContent = msg; el.className = `alert ${type}`; el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 4000);
    }
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    // Init
    loadClasses();
    loadAssignments();
    loadAnalytics();
});
