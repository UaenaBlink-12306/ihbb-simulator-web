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
    const KEY_COACH_LOCAL = 'ihbb_v2_coach_attempts';
    const SESSION_SYNC_TABLE = 'user_drill_sessions';
    const COACH_SYNC_TABLE = 'user_coach_attempts';
    const COACH_DRILL_STORAGE_KEY = 'ihbb_student_coach_drill';
    const ANALYTICS_INSIGHTS_CACHE_KEY = `ihbb_student_analytics_insights_${uid}`;
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
    const setMetric = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };
    const emptyStateHtml = (kicker, title, copy) => `
        <div class="empty-state">
            <div class="empty-kicker">${esc(kicker)}</div>
            <h3 class="empty-title">${esc(title)}</h3>
            <p class="empty-copy">${esc(copy)}</p>
        </div>
    `;
    const canonicalCoachAnswer = (value) => String(value || '')
        .trim()
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s*\[[^\]]*\]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[ ,;:.]+$/g, '')
        .trim();
    const coachWikiLink = (value) => {
        const canonical = canonicalCoachAnswer(value);
        return canonical ? `https://en.wikipedia.org/wiki/${encodeURIComponent(canonical.replace(/\s+/g, '_'))}` : '';
    };
    const normalizeCoachList = (items, fallback = [], max = 5) => {
        const source = Array.isArray(items) ? items : [];
        const list = source.map(x => String(x || '').trim()).filter(Boolean).slice(0, max);
        if (list.length) return list;
        return (Array.isArray(fallback) ? fallback : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, max);
    };
    const coachListHtml = (items) => {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return '';
        return `<ul class="coach-inline-list">${list.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
    };
    const coachWikiHtml = (coach) => {
        const wiki = String(coach?.wiki_link || '').trim();
        if (!wiki) return '';
        const label = String(coach?.canonical_answer || 'Wikipedia').trim() || 'Wikipedia';
        return `<div><b>Read More:</b> <a class="coach-link" href="${esc(wiki)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a></div>`;
    };

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

    function activateDashboardTab(tabName) {
        document.querySelectorAll('.dash-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        document.querySelectorAll('.view').forEach(c => c.classList.remove('active'));
        document.getElementById('tab-' + tabName)?.classList.add('active');
        if (tabName === 'analytics') loadAnalytics();
        if (tabName === 'coach') loadCoachWorkspace(false);
    }

    // ========== TAB SWITCHING ==========
    document.querySelectorAll('.dash-tab').forEach(tab => {
        tab.addEventListener('click', () => activateDashboardTab(tab.dataset.tab));
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
        setMetric('student-hero-classes', list.length);
        if (!list.length) {
            el.innerHTML = emptyStateHtml('Classes', 'No classes yet', 'Use the invite code above to join your first classroom.');
            return;
        }
        el.innerHTML = list.map(cs => {
            const c = cs.classes;
            return `<div class="list-item">
                <span class="item-title">${esc(c.name)}</span>
                <span class="item-badge">${c.code}</span>
                <div class="item-actions">
                    <button class="btn bad" onclick="leaveClass('${cs.class_id}')">Leave</button>
                </div>
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

    document.getElementById('btn-assignments-coach-tab')?.addEventListener('click', () => activateDashboardTab('coach'));
    document.getElementById('btn-assignments-coach-drill')?.addEventListener('click', () => launchCoachGuidedDrill());
    document.getElementById('btn-coach-refresh')?.addEventListener('click', async () => {
        await loadCoachWorkspace(true);
    });

    function handleCoachFocusAction(event) {
        const drillBtn = event.target.closest('.coach-focus-drill');
        if (drillBtn) {
            const focus = coachFocusSuggestionsCurrent[Number(drillBtn.dataset.focusIndex) || 0] || null;
            launchCoachGuidedDrill(focus);
            return;
        }
        const masteredBtn = event.target.closest('.coach-focus-mastered');
        if (masteredBtn) {
            persistCoachMastered(masteredBtn.dataset.attempt || '', true);
            return;
        }
        if (event.target.closest('.coach-focus-open-analytics')) {
            activateDashboardTab('analytics');
        }
    }

    document.getElementById('coach-focus-list')?.addEventListener('click', handleCoachFocusAction);
    document.getElementById('assignments-coach-focuses')?.addEventListener('click', handleCoachFocusAction);
    document.getElementById('coach-note-list')?.addEventListener('click', (event) => {
        const drillBtn = event.target.closest('.coach-note-drill');
        if (drillBtn) {
            const attemptId = String(drillBtn.dataset.attempt || '').trim();
            const record = coachRecordsCurrent.find(item => item.client_attempt_id === attemptId);
            launchCoachGuidedDrill(record ? {
                ...coachFocusFromRecord(record),
                title: [coachFocusFromRecord(record).region, coachFocusFromRecord(record).era, coachFocusFromRecord(record).topic].filter(Boolean).join(' • ') || 'Coach focus',
                reason: record?.coach?.summary || record?.reason || '',
                source: 'coach-note'
            } : null);
            return;
        }
        const toggleBtn = event.target.closest('.coach-toggle-mastered');
        if (toggleBtn) {
            const current = (toggleBtn.dataset.mastered || '0') === '1';
            persistCoachMastered(toggleBtn.dataset.attempt || '', !current);
        }
    });

    // ========== ASSIGNMENTS ==========
    async function loadAssignments() {
        const { data: memberships } = await sb.from('class_students').select('class_id').eq('student_id', uid);
        if (!memberships || !memberships.length) {
            setMetric('student-hero-todo', 0);
            setMetric('student-hero-done', 0);
            document.getElementById('student-assignments-todo').innerHTML = emptyStateHtml('Assignments', 'Join a class first', 'Assignments will appear here once you are enrolled in at least one classroom.');
            document.getElementById('student-assignments-completed').innerHTML = emptyStateHtml('Completed', 'Nothing completed yet', 'Finished assignments and redo links will appear here after your first drill.');
            renderAssignmentsCoachBrief();
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
        setMetric('student-hero-todo', todoList.length);
        setMetric('student-hero-done', doneList.length);

        // Render To Do
        if (!todoList.length) {
            todoEl.innerHTML = emptyStateHtml('To do', 'All caught up', 'You do not have any pending assignments right now.');
        } else {
            todoEl.innerHTML = todoList.map(a => {
                const due = a.due_date ? new Date(a.due_date).toLocaleDateString() : 'No deadline';
                const cls = a.classes?.name || '';
                return `<div class="list-item">
                    <span class="item-title">${esc(a.title)}</span>
                    <span class="item-meta">${esc(cls)} · Due: ${due}</span>
                    <div class="item-actions">
                        <button class="btn pri" onclick="startAssignment('${a.id}', '${esc(a.title)}')">Start</button>
                    </div>
                </div>`;
            }).join('');
        }

        // Render Completed
        if (!doneList.length) {
            doneEl.innerHTML = emptyStateHtml('Completed', 'No completed assignments yet', 'Completed work and redo shortcuts will appear here.');
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
                    <div class="item-actions">
                        <button class="btn ghost" onclick="startAssignment('${a.id}', '${esc(a.title)}')">Redo</button>
                    </div>
                </div>`;
            }).join('');
        }

        // Update sub-tab labels with counts
        document.querySelectorAll('.assign-sub-tab').forEach(t => {
            if (t.dataset.sub === 'todo') t.textContent = `📋 To Do (${todoList.length})`;
            if (t.dataset.sub === 'completed') t.textContent = `✅ Completed (${doneList.length})`;
        });
        renderAssignmentsCoachBrief();
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

    function normalizeCoachRecord(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const coach = source.coach && typeof source.coach === 'object' ? source.coach : {};
        const focus = coach.study_focus && typeof coach.study_focus === 'object' ? coach.study_focus : {};
        return {
            client_attempt_id: String(source.client_attempt_id || '').trim(),
            client_session_id: String(source.client_session_id || '').trim(),
            question_text: String(source.question_text || '').trim(),
            expected_answer: String(source.expected_answer || '').trim(),
            user_answer: String(source.user_answer || '').trim(),
            correct: !!source.correct,
            reason: String(source.reason || '').trim(),
            category: String(source.category || focus.region || '').trim(),
            era: String(source.era || focus.era || '').trim(),
            source: String(source.source || '').trim(),
            focus_topic: String(source.focus_topic || focus.topic || '').trim(),
            mastered: !!source.mastered,
            mastered_at: source.mastered_at || null,
            created_at: source.created_at || null,
            coach: {
                summary: String(coach.summary || '').trim(),
                error_diagnosis: String(coach.error_diagnosis || coach.explanation || '').trim(),
                overlap_explainer: String(coach.overlap_explainer || '').trim(),
                explanation_bullets: normalizeCoachList(coach.explanation_bullets || (coach.explanation ? [coach.explanation] : [])),
                related_facts: normalizeCoachList(coach.related_facts || []),
                key_clues: normalizeCoachList(coach.key_clues || [], [
                    'Track the clue that uniquely identifies the expected answer.',
                    'Use the era and region to eliminate close alternatives.'
                ], 4),
                study_tip: String(coach.study_tip || coach.memory_hook || coach.next_check_question || '').trim(),
                canonical_answer: canonicalCoachAnswer(coach.canonical_answer || source.expected_answer || ''),
                wiki_link: String(coach.wiki_link || coachWikiLink(coach.canonical_answer || source.expected_answer || '')).trim(),
                study_focus: {
                    region: String(focus.region || source.category || '').trim(),
                    era: String(focus.era || source.era || '').trim(),
                    topic: String(focus.topic || source.focus_topic || '').trim(),
                    icon: String(focus.icon || '📘').trim() || '📘'
                }
            }
        };
    }

    function readCoachLocalRecords() {
        return safeReadJson(KEY_COACH_LOCAL, []).map(normalizeCoachRecord);
    }

    function writeCoachLocalRecords(records) {
        try {
            localStorage.setItem(KEY_COACH_LOCAL, JSON.stringify((Array.isArray(records) ? records : []).slice(0, 300)));
        } catch {
            // Ignore local storage failures.
        }
    }

    async function fetchCoachRecordsFromCloud(forceCloud = false) {
        const { data, error } = await sb
            .from(COACH_SYNC_TABLE)
            .select('client_attempt_id, client_session_id, question_text, expected_answer, user_answer, correct, reason, coach, category, era, source, focus_topic, mastered, mastered_at, created_at')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(200);
        if (error) throw error;
        const records = (Array.isArray(data) ? data : []).map(normalizeCoachRecord);
        writeCoachLocalRecords(records);
        return records;
    }

    function coachFocusFromRecord(record) {
        const focus = record?.coach?.study_focus || {};
        return {
            region: String(focus.region || record?.category || '').trim(),
            era: String(focus.era || record?.era || '').trim(),
            topic: String(focus.topic || record?.focus_topic || '').trim(),
            icon: String(focus.icon || '📘').trim() || '📘'
        };
    }

    function parseWeakAreaTitle(title) {
        const raw = String(title || '').trim();
        const match = raw.match(/^(Region|Era|Focus)\s*:\s*(.+)$/i);
        if (!match) return { dimension: 'Focus', value: raw };
        return { dimension: match[1].trim(), value: match[2].trim() };
    }

    function getCachedAnalyticsCoachFocuses() {
        const cache = readAnalyticsInsightsCache();
        let normalized = null;
        if (cache?.result) {
            normalized = normalizeAnalyticsInsightsResult(cache.result, analyticsSnapshotCurrent);
        } else if (analyticsSnapshotCurrent && analyticsSnapshotCurrent.totalAttempts > 0) {
            normalized = {
                source: 'fallback',
                insights: buildLocalAnalyticsInsights(analyticsSnapshotCurrent)
            };
        }
        if (!normalized) return [];
        const weak = Array.isArray(normalized?.insights?.weak_areas) ? normalized.insights.weak_areas : [];
        return weak.map((item, index) => {
            const parsed = parseWeakAreaTitle(item.title);
            return {
                key: `analytics-${index}-${parsed.dimension}-${parsed.value}`,
                title: item.title,
                region: parsed.dimension.toLowerCase() === 'region' ? parsed.value : '',
                era: parsed.dimension.toLowerCase() === 'era' ? parsed.value : '',
                topic: '',
                icon: parsed.dimension.toLowerCase() === 'region' ? '🧭' : (parsed.dimension.toLowerCase() === 'era' ? '🕰️' : '📘'),
                meta: String(item.evidence || '').trim(),
                reason: String(item.why || item.evidence || '').trim(),
                action: String(item.action || '').trim(),
                priority: String(item.priority || 'medium').trim().toLowerCase(),
                source: 'analytics'
            };
        });
    }

    function buildCoachFocusSuggestions() {
        const entries = new Map();
        for (const record of coachRecordsCurrent) {
            const focus = coachFocusFromRecord(record);
            if (!focus.region && !focus.era && !focus.topic) continue;
            const key = `${focus.region}|${focus.era}|${focus.topic}`;
            if (!entries.has(key)) {
                entries.set(key, {
                    key,
                    region: focus.region,
                    era: focus.era,
                    topic: focus.topic,
                    icon: focus.icon,
                    attempts: 0,
                    incorrect: 0,
                    unresolved: 0,
                    latestTs: 0,
                    sample: record
                });
            }
            const entry = entries.get(key);
            entry.attempts += 1;
            if (!record.correct) entry.incorrect += 1;
            if (!record.mastered) entry.unresolved += 1;
            const ts = record.created_at ? new Date(record.created_at).getTime() : 0;
            if (ts >= entry.latestTs) {
                entry.latestTs = ts;
                entry.sample = record;
            }
        }

        const fromCoach = Array.from(entries.values())
            .sort((a, b) => (b.unresolved - a.unresolved) || (b.incorrect - a.incorrect) || (b.attempts - a.attempts) || (b.latestTs - a.latestTs))
            .map(entry => {
                const sample = entry.sample;
                const recordFocus = coachFocusFromRecord(sample);
                const titleParts = [recordFocus.region, recordFocus.era, recordFocus.topic].filter(Boolean);
                const priority = entry.unresolved >= 3 || entry.incorrect >= 2 ? 'high' : (entry.unresolved >= 1 ? 'medium' : 'low');
                return {
                    key: entry.key,
                    title: titleParts.join(' • ') || 'Coach focus',
                    region: recordFocus.region,
                    era: recordFocus.era,
                    topic: recordFocus.topic,
                    icon: recordFocus.icon,
                    meta: `${entry.unresolved} open lesson${entry.unresolved === 1 ? '' : 's'} • ${entry.incorrect} incorrect`,
                    reason: sample?.coach?.summary || sample?.coach?.error_diagnosis || sample?.reason || 'DeepSeek highlighted this area repeatedly in your recent lessons.',
                    action: sample?.coach?.study_tip || sample?.coach?.key_clues?.[0] || sample?.coach?.related_facts?.[0] || 'Start a targeted drill around this focus.',
                    priority,
                    source: 'coach',
                    attemptId: sample?.client_attempt_id || ''
                };
            });

        const combined = [];
        const seen = new Set();
        for (const focus of [...fromCoach, ...getCachedAnalyticsCoachFocuses()]) {
            if (!focus || !focus.key || seen.has(focus.key)) continue;
            seen.add(focus.key);
            combined.push(focus);
        }
        return combined.slice(0, 4);
    }

    function getTopCoachFocus() {
        return coachFocusSuggestionsCurrent[0] || null;
    }

    function launchCoachGuidedDrill(focus = null) {
        const target = focus || getTopCoachFocus();
        if (!target) {
            showAlert('No coach-guided focus is available yet.', 'error');
            return;
        }
        try {
            localStorage.setItem(COACH_DRILL_STORAGE_KEY, JSON.stringify({
                region: target.region || '',
                era: target.era || '',
                topic: target.topic || '',
                title: target.title || '',
                reason: target.reason || '',
                source: target.source || 'student-dashboard',
                ts: Date.now()
            }));
        } catch {
            // Ignore storage failures; the drill can still open.
        }
        window.location.href = 'index.html?drill=1&coach=1';
    }

    function renderCoachFocusCards(containerId, focuses, emptyText) {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (!focuses.length) {
            el.innerHTML = `<div class="coach-empty">${esc(emptyText)}</div>`;
            return;
        }
        el.innerHTML = focuses.map((focus, index) => `
            <div class="coach-focus-card">
                <div class="coach-focus-head">
                    <div>
                        <div class="coach-focus-title">${esc(focus.icon || '📘')} ${esc(focus.title)}</div>
                        <div class="coach-focus-meta">${esc(focus.meta || 'Targeted DeepSeek focus')}</div>
                    </div>
                    <span class="analytics-ai-priority ${esc(focus.priority || 'medium')}">${esc(focus.priority || 'medium')}</span>
                </div>
                <p class="coach-focus-reason">${esc(focus.reason || 'This is one of the clearest places to tighten your recall and clue recognition.')}</p>
                <div class="coach-focus-tags">
                    ${focus.region ? `<span class="coach-focus-pill">Region: ${esc(focus.region)}</span>` : ''}
                    ${focus.era ? `<span class="coach-focus-pill">Era: ${esc(focus.era)}</span>` : ''}
                    ${focus.topic ? `<span class="coach-focus-pill">Topic: ${esc(focus.topic)}</span>` : ''}
                </div>
                <div class="coach-focus-actions">
                    <button class="btn pri coach-focus-drill" type="button" data-focus-index="${index}">Guided Drill</button>
                    ${focus.attemptId ? `<button class="btn ghost coach-focus-mastered" type="button" data-attempt="${esc(focus.attemptId)}">Mark Top Lesson Mastered</button>` : `<button class="btn ghost coach-focus-open-analytics" type="button">View Analytics</button>`}
                </div>
            </div>
        `).join('');
    }

    function renderAssignmentsCoachBrief() {
        const summaryEl = document.getElementById('assignments-coach-summary');
        const focusEl = document.getElementById('assignments-coach-focuses');
        const drillBtn = document.getElementById('btn-assignments-coach-drill');
        if (!summaryEl || !focusEl || !drillBtn) return;
        const focuses = coachFocusSuggestionsCurrent.slice(0, 2);
        drillBtn.disabled = !focuses.length;
        if (!focuses.length) {
            summaryEl.textContent = 'DeepSeek prep suggestions will appear here once you build up some coach notes or analytics history.';
            focusEl.innerHTML = '<div class="coach-empty">Practice a few more questions to unlock targeted assignment prep.</div>';
            return;
        }
        const primary = focuses[0];
        summaryEl.textContent = `Before your next assignment, put extra attention on ${primary.title}. The coach is seeing repeat friction there across your recent practice.`;
        renderCoachFocusCards('assignments-coach-focuses', focuses, 'No assignment prep suggestions yet.');
    }

    function renderCoachWorkspace() {
        const unresolved = coachRecordsCurrent.filter(r => !r.mastered).length;
        setMetric('student-hero-coach', unresolved);
        coachFocusSuggestionsCurrent = buildCoachFocusSuggestions();
        const badgeEl = document.getElementById('coach-workspace-badge');
        const summaryEl = document.getElementById('coach-workspace-summary');
        const noteEl = document.getElementById('coach-note-list');
        if (badgeEl) {
            badgeEl.textContent = unresolved ? `${unresolved} open` : (coachFocusSuggestionsCurrent.length ? 'Guided' : 'Empty');
        }
        if (summaryEl) {
            if (coachFocusSuggestionsCurrent.length) {
                const lead = coachFocusSuggestionsCurrent[0];
                summaryEl.textContent = `Your strongest next move is ${lead.title}. DeepSeek has enough history to steer you toward a focused drill instead of another broad mixed session.`;
            } else {
                summaryEl.textContent = 'Once DeepSeek has a few saved lessons or analytics signals, this workspace will start grouping them into actionable drills.';
            }
        }

        renderCoachFocusCards('coach-focus-list', coachFocusSuggestionsCurrent, 'No coach focuses yet. Missed-question lessons from practice will accumulate here.');

        if (noteEl) {
            if (!coachRecordsCurrent.length) {
                noteEl.innerHTML = '<div class="coach-empty">No DeepSeek coach lessons saved yet.</div>';
            } else {
                noteEl.innerHTML = coachRecordsCurrent.map(record => {
                    const focus = coachFocusFromRecord(record);
                    const coach = record.coach || {};
                    const created = record.created_at ? new Date(record.created_at).toLocaleString() : '—';
                    return `
                        <div class="coach-note ${record.mastered ? 'mastered' : ''}" data-attempt="${esc(record.client_attempt_id)}">
                            <div class="coach-note-head">
                                <div class="coach-note-icon">${esc(focus.icon || '📘')}</div>
                                <div class="coach-note-meta">
                                    <div><b>${record.correct ? '✓ Correct' : '✗ Incorrect'}</b> • ${esc(created)}</div>
                                    <div class="muted">${esc(focus.region || 'World')}${focus.era ? ' • ' + esc(focus.era) : ''}${focus.topic ? ' • ' + esc(focus.topic) : ''}</div>
                                </div>
                            </div>
                            <details>
                                <summary>${esc((record.question_text || '').slice(0, 180))}${(record.question_text || '').length > 180 ? '…' : ''}</summary>
                                <div class="coach-note-body">
                                    <div><b>Your answer:</b> ${esc(record.user_answer || '(blank)')}</div>
                                    <div><b>Expected:</b> ${esc(record.expected_answer || '')}</div>
                                    <div><b>Summary:</b> ${esc(coach.summary || '')}</div>
                                    <div><b>Error Diagnosis:</b> ${esc(coach.error_diagnosis || '')}</div>
                                    <div><b>Overlap Explainer:</b> ${esc(coach.overlap_explainer || '')}</div>
                                    <div><b>Why This Answer Fits:</b>${coachListHtml(coach.explanation_bullets || [])}</div>
                                    <div><b>Key Clues:</b>${coachListHtml(coach.key_clues || [])}</div>
                                    <div><b>Related Facts:</b>${coachListHtml(coach.related_facts || [])}</div>
                                    <div><b>Study Tip:</b> ${esc(coach.study_tip || '')}</div>
                                    ${coachWikiHtml(coach)}
                                    <div class="coach-note-actions">
                                        <button class="btn pri coach-note-drill" type="button" data-attempt="${esc(record.client_attempt_id)}">Use in Guided Drill</button>
                                        <button class="btn ghost coach-toggle-mastered" type="button" data-attempt="${esc(record.client_attempt_id)}" data-mastered="${record.mastered ? '1' : '0'}">${record.mastered ? 'Unmark Mastered' : 'Mark Mastered'}</button>
                                    </div>
                                </div>
                            </details>
                        </div>
                    `;
                }).join('');
            }
        }

        renderAssignmentsCoachBrief();
    }

    async function persistCoachMastered(attemptId, mastered) {
        const id = String(attemptId || '').trim();
        if (!id) return;
        const updatedAt = mastered ? new Date().toISOString() : null;
        coachRecordsCurrent = coachRecordsCurrent.map(record => (
            record.client_attempt_id === id
                ? { ...record, mastered: !!mastered, mastered_at: updatedAt }
                : record
        ));
        writeCoachLocalRecords(coachRecordsCurrent);
        renderCoachWorkspace();

        if (!coachCloudReady) return;
        try {
            const { error } = await sb
                .from(COACH_SYNC_TABLE)
                .update({ mastered: !!mastered, mastered_at: updatedAt })
                .eq('user_id', uid)
                .eq('client_attempt_id', id);
            if (error) throw error;
        } catch (err) {
            console.warn('Coach mastered sync failed, using local state:', err);
            if (isCloudAnalyticsSetupIssue(err) && !coachCloudWarned) {
                coachCloudReady = false;
                coachCloudWarned = true;
                showAlert('Cloud coach sync is not set up yet; using local coach notes on this device.', 'error');
            }
        }
    }

    async function loadCoachWorkspace(forceCloud = false) {
        let records = [];
        if (coachCloudReady) {
            try {
                records = await fetchCoachRecordsFromCloud(forceCloud);
            } catch (err) {
                console.warn('Coach cloud fetch failed, using local fallback:', err);
                records = readCoachLocalRecords();
                if (isCloudAnalyticsSetupIssue(err)) {
                    coachCloudReady = false;
                    if (!coachCloudWarned) {
                        coachCloudWarned = true;
                        showAlert('Cloud coach notebook is not set up yet; using local coach notes on this device.', 'error');
                    }
                }
            }
        } else {
            records = readCoachLocalRecords();
        }
        coachRecordsCurrent = records;
        renderCoachWorkspace();
    }

    // ========== ANALYTICS ==========
    document.getElementById('btn-analytics-refresh')?.addEventListener('click', loadAnalytics);
    document.getElementById('btn-analytics-ai')?.addEventListener('click', () => generateAnalyticsInsights(true));

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
    let analyticsSnapshotCurrent = null;
    let coachCloudReady = true;
    let coachCloudWarned = false;
    let coachRecordsCurrent = [];
    let coachFocusSuggestionsCurrent = [];

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

    function roundedMetric(value, digits = 2) {
        return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
    }

    function weakStatsForInsight(stats, dim) {
        return (Array.isArray(stats) ? stats : [])
            .filter(s => s && s.attempts >= 3)
            .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts || a.name.localeCompare(b.name))
            .slice(0, 5)
            .map(s => ({ ...s, dim }));
    }

    function strongStatsForInsight(stats, dim) {
        return (Array.isArray(stats) ? stats : [])
            .filter(s => s && s.attempts >= 4)
            .sort((a, b) => b.accuracy - a.accuracy || b.attempts - a.attempts || a.name.localeCompare(b.name))
            .slice(0, 6)
            .map(s => ({ ...s, dim }));
    }

    function dedupeInsightAreas(list) {
        const out = [];
        const seen = new Set();
        for (const area of Array.isArray(list) ? list : []) {
            const dim = String(area?.dim || area?.dimension || 'Focus').trim();
            const name = String(area?.name || area?.title || '').trim();
            if (!name) continue;
            const key = `${dim}|${name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ ...area, dim, name });
        }
        return out;
    }

    function buildAnalyticsInsightPayload(snapshot) {
        if (!snapshot) return null;
        const weakEras = weakStatsForInsight(snapshot.eraStats, 'Era');
        const weakRegions = weakStatsForInsight(snapshot.regionStats, 'Region');
        const strengths = dedupeInsightAreas([
            ...strongStatsForInsight(snapshot.eraStats, 'Era'),
            ...strongStatsForInsight(snapshot.regionStats, 'Region')
        ]).slice(0, 4);

        const mapArea = area => ({
            name: area.name,
            dim: area.dim,
            attempts: area.attempts,
            correct: area.correct,
            accuracy: area.accuracy,
            avg_buzz: roundedMetric(area.avgBuzz, 2)
        });

        return {
            window_days: 30,
            summary: {
                total_attempts: snapshot.totalAttempts,
                total_accuracy: snapshot.totalAccuracy,
                avg_buzz_seconds: roundedMetric(snapshot.avgBuzz, 2),
                sessions: snapshot.sessionsCount,
                active_days: snapshot.activeDays,
                fastest_buzz_seconds: roundedMetric(snapshot.fastestBuzz, 2),
                accuracy_delta_7d: roundedMetric(snapshot.accDelta7d, 1),
                buzz_delta_7d: roundedMetric(snapshot.buzzDelta7d, 2)
            },
            blind_spots: (Array.isArray(snapshot.blindSpots) ? snapshot.blindSpots : []).slice(0, 6).map(mapArea),
            weak_eras: weakEras.map(mapArea),
            weak_regions: weakRegions.map(mapArea),
            strengths: strengths.map(mapArea)
        };
    }

    function analyticsInsightSignature(snapshot) {
        const payload = buildAnalyticsInsightPayload(snapshot);
        return payload ? JSON.stringify(payload) : '';
    }

    function readAnalyticsInsightsCache() {
        return safeReadJson(ANALYTICS_INSIGHTS_CACHE_KEY, null);
    }

    function writeAnalyticsInsightsCache(signature, result) {
        try {
            localStorage.setItem(ANALYTICS_INSIGHTS_CACHE_KEY, JSON.stringify({
                signature,
                result,
                ts: Date.now()
            }));
        } catch {
            // Ignore storage quota or serialization issues.
        }
    }

    function insightPriority(area) {
        if ((area.accuracy || 0) < 50 || (area.attempts || 0) >= 10) return 'high';
        if ((area.accuracy || 0) < 70) return 'medium';
        return 'low';
    }

    function insightAction(area) {
        const dim = String(area?.dim || area?.dimension || '').trim().toLowerCase();
        const name = String(area?.name || area?.title || 'this area').trim();
        if (dim === 'era') {
            return `Run two short drills in ${name} and write down three timeline anchors before buzzing.`;
        }
        if (dim === 'region') {
            return `Practice ${name} in mixed-region sets and wait for one uniquely regional clue before buzzing in.`;
        }
        return `Build one short focused set on ${name} and slow your buzz until the disambiguating clue appears.`;
    }

    function buildLocalAnalyticsInsights(snapshot) {
        const payload = buildAnalyticsInsightPayload(snapshot) || {
            summary: {},
            blind_spots: [],
            weak_eras: [],
            weak_regions: [],
            strengths: []
        };
        const candidates = dedupeInsightAreas([
            ...(payload.blind_spots || []),
            ...(payload.weak_eras || []),
            ...(payload.weak_regions || [])
        ]);
        const weakAreas = candidates.slice(0, 3).map(area => ({
            title: `${area.dim}: ${area.name}`,
            dimension: area.dim,
            why: area.accuracy < 55
                ? 'You are missing too many questions in this slice for it to stay in mixed practice.'
                : 'This segment is trailing the rest of your chart and is likely dragging overall accuracy down.',
            evidence: `${area.accuracy}% accuracy over ${area.attempts} questions${area.avg_buzz ? ` with a ${area.avg_buzz.toFixed(2)}s average buzz.` : '.'}`,
            action: insightAction(area),
            priority: insightPriority(area)
        }));
        const wins = (payload.strengths || []).slice(0, 2).map(area =>
            `${area.dim}: ${area.name} is holding at ${area.accuracy}% across ${area.attempts} questions.`
        );
        const nextSteps = [];
        if (weakAreas[0]) nextSteps.push(weakAreas[0].action);
        if (weakAreas[1]) nextSteps.push(weakAreas[1].action);
        if ((payload.summary?.active_days || 0) < 5) {
            nextSteps.push('Add three shorter practice days this week so weak-area review is repeated instead of crammed.');
        }
        if (Number.isFinite(payload.summary?.accuracy_delta_7d) && payload.summary.accuracy_delta_7d < 0) {
            nextSteps.push('Pause mixed drilling for one session and rebuild accuracy with targeted review before speeding up again.');
        }
        if (!nextSteps.length) {
            nextSteps.push('Keep one mixed drill and one targeted weak-area drill in the same week to stabilize gains.');
        }

        const headline = weakAreas[0]
            ? `${weakAreas[0].title} is the clearest weak area to improve next.`
            : 'Your analytics are starting to show a few workable study patterns.';
        const overview = `Over the last 30 days you answered ${payload.summary?.total_attempts || 0} questions at ${payload.summary?.total_accuracy || 0}% accuracy across ${payload.summary?.sessions || 0} sessions and ${payload.summary?.active_days || 0} active days.`;
        const confidence = (payload.summary?.total_attempts || 0) >= 40 ? 'high' : ((payload.summary?.total_attempts || 0) >= 15 ? 'medium' : 'low');

        return {
            headline,
            overview,
            weak_areas: weakAreas,
            wins,
            next_steps: nextSteps.slice(0, 4),
            confidence
        };
    }

    function normalizeAnalyticsInsightsResult(raw, snapshot) {
        const fallback = buildLocalAnalyticsInsights(snapshot);
        const wrapper = raw && typeof raw === 'object' ? raw : {};
        const candidate = wrapper.insights && typeof wrapper.insights === 'object' ? wrapper.insights : wrapper;
        const fallbackWeakAreas = Array.isArray(fallback.weak_areas) ? fallback.weak_areas : [];

        const weakAreas = Array.isArray(candidate.weak_areas)
            ? candidate.weak_areas.map((item, index) => {
                const title = String(item?.title || item?.name || '').trim();
                if (!title) return null;
                const fb = fallbackWeakAreas[index] || fallbackWeakAreas[0] || {
                    why: 'This slice is underperforming compared with the rest of your recent practice.',
                    evidence: 'Recent drill results show this area needs more attention.',
                    action: 'Run one short focused drill on this area before returning to mixed practice.',
                    priority: 'medium'
                };
                const priorityRaw = String(item?.priority || '').trim().toLowerCase();
                return {
                    title,
                    dimension: String(item?.dimension || item?.dim || 'Focus').trim() || 'Focus',
                    why: String(item?.why || item?.diagnosis || '').trim() || fb.why,
                    evidence: String(item?.evidence || '').trim() || fb.evidence,
                    action: String(item?.action || item?.recommendation || '').trim() || fb.action,
                    priority: ['high', 'medium', 'low'].includes(priorityRaw) ? priorityRaw : fb.priority
                };
            }).filter(Boolean).slice(0, 3)
            : [];

        const wins = Array.isArray(candidate.wins)
            ? candidate.wins.map(x => String(x || '').trim()).filter(Boolean).slice(0, 3)
            : [];
        const nextSteps = Array.isArray(candidate.next_steps)
            ? candidate.next_steps.map(x => String(x || '').trim()).filter(Boolean).slice(0, 4)
            : [];
        const confidenceRaw = String(candidate.confidence || '').trim().toLowerCase();

        return {
            source: String(wrapper.source || '').trim().toLowerCase() === 'deepseek' ? 'deepseek' : 'fallback',
            insights: {
                headline: String(candidate.headline || '').trim() || fallback.headline,
                overview: String(candidate.overview || '').trim() || fallback.overview,
                weak_areas: weakAreas.length ? weakAreas : fallback.weak_areas,
                wins: wins.length ? wins : fallback.wins,
                next_steps: nextSteps.length ? nextSteps : fallback.next_steps,
                confidence: ['high', 'medium', 'low'].includes(confidenceRaw) ? confidenceRaw : fallback.confidence
            }
        };
    }

    function setAnalyticsInsightsButton(label, disabled) {
        const btn = document.getElementById('btn-analytics-ai');
        if (!btn) return;
        btn.textContent = label;
        btn.disabled = !!disabled;
    }

    function renderAnalyticsInsightsPlaceholder(title, copy, badge = 'Ready', statusText = copy) {
        const badgeEl = document.getElementById('analytics-ai-badge');
        const statusEl = document.getElementById('analytics-ai-status');
        const contentEl = document.getElementById('analytics-ai-content');
        if (badgeEl) badgeEl.textContent = badge;
        if (statusEl) statusEl.textContent = statusText;
        if (contentEl) {
            contentEl.innerHTML = `
                <div class="analytics-ai-placeholder">
                    <h4>${esc(title)}</h4>
                    <p class="muted">${esc(copy)}</p>
                </div>
            `;
        }
    }

    function renderAnalyticsInsights(result, cached = false) {
        const normalized = normalizeAnalyticsInsightsResult(result, analyticsSnapshotCurrent);
        const { source, insights } = normalized;
        const badgeEl = document.getElementById('analytics-ai-badge');
        const statusEl = document.getElementById('analytics-ai-status');
        const contentEl = document.getElementById('analytics-ai-content');
        if (badgeEl) {
            badgeEl.textContent = cached
                ? (source === 'deepseek' ? 'Cached AI' : 'Cached plan')
                : (source === 'deepseek' ? 'DeepSeek AI' : 'Local fallback');
        }
        if (statusEl) {
            statusEl.textContent = source === 'deepseek'
                ? 'DeepSeek analyzed your current 30-day snapshot and highlighted the biggest weak areas to target next.'
                : 'DeepSeek was unavailable, so this plan was generated from your analytics snapshot locally.';
        }
        if (contentEl) {
            const weakAreasHtml = (Array.isArray(insights.weak_areas) ? insights.weak_areas : []).map(area => `
                <div class="analytics-ai-focus">
                    <div class="analytics-ai-focus-head">
                        <div class="analytics-ai-focus-title">${esc(area.title)}</div>
                        <span class="analytics-ai-priority ${esc(area.priority)}">${esc(area.priority)}</span>
                    </div>
                    <p>${esc(area.why)}</p>
                    <p>${esc(area.evidence)}</p>
                    <p><strong>Next move:</strong> ${esc(area.action)}</p>
                </div>
            `).join('');
            const winsHtml = (Array.isArray(insights.wins) ? insights.wins : []).map(item => `<li>${esc(item)}</li>`).join('');
            const stepsHtml = (Array.isArray(insights.next_steps) ? insights.next_steps : []).map(item => `<li>${esc(item)}</li>`).join('');

            contentEl.innerHTML = `
                <div class="analytics-ai-block">
                    <h4>${esc(insights.headline)}</h4>
                    <p class="analytics-ai-overview">${esc(insights.overview)}</p>
                </div>
                <div class="analytics-ai-grid">
                    <div class="analytics-ai-block">
                        <h4>Priority Weak Areas</h4>
                        <div class="analytics-ai-list">${weakAreasHtml || '<p class="muted">No major weak area has emerged yet.</p>'}</div>
                    </div>
                    <div class="analytics-ai-block">
                        <h4>What Is Holding Up</h4>
                        <ul class="analytics-ai-compact-list">${winsHtml || '<li>Keep building attempts so the model can separate true strengths from noise.</li>'}</ul>
                    </div>
                    <div class="analytics-ai-block">
                        <h4>Next Study Moves</h4>
                        <ul class="analytics-ai-compact-list">${stepsHtml || '<li>Run one targeted drill and one mixed drill this week.</li>'}</ul>
                    </div>
                </div>
            `;
        }
        setAnalyticsInsightsButton('Refresh Insights', false);
        renderCoachWorkspace();
    }

    function prepareAnalyticsInsights(snapshot, hasData) {
        analyticsSnapshotCurrent = hasData ? snapshot : null;
        if (!hasData || !snapshot) {
            setAnalyticsInsightsButton('Generate Insights', true);
            renderAnalyticsInsightsPlaceholder(
                'AI insights are waiting for data',
                'Complete a few drill questions first so weak-area recommendations have real evidence behind them.',
                'No data',
                'Answer a few questions and refresh analytics to unlock AI insights.'
            );
            return;
        }

        const signature = analyticsInsightSignature(snapshot);
        const cache = readAnalyticsInsightsCache();
        if (cache?.signature === signature && cache?.result) {
            renderAnalyticsInsights(cache.result, true);
            return;
        }

        setAnalyticsInsightsButton('Generate Insights', false);
        renderAnalyticsInsightsPlaceholder(
            'Generate a focused study plan',
            'Use DeepSeek to summarize your weakest eras and regions from the current 30-day snapshot.',
            'Ready',
            'Generate a DeepSeek summary to translate this analytics snapshot into targeted study moves.'
        );
        renderAssignmentsCoachBrief();
    }

    async function generateAnalyticsInsights(force = false) {
        if (!analyticsSnapshotCurrent || analyticsSnapshotCurrent.totalAttempts <= 0) {
            showAlert('Complete a few drill questions before generating AI insights.', 'error');
            return;
        }

        const signature = analyticsInsightSignature(analyticsSnapshotCurrent);
        const cache = readAnalyticsInsightsCache();
        if (!force && cache?.signature === signature && cache?.result) {
            renderAnalyticsInsights(cache.result, true);
            return;
        }

        setAnalyticsInsightsButton('Analyzing...', true);
        renderAnalyticsInsightsPlaceholder(
            'DeepSeek is reviewing your analytics',
            'Scanning recent weak areas, trend shifts, and consistency patterns to build a short study plan.',
            'Analyzing',
            'DeepSeek is reviewing your latest 30-day history now.'
        );

        try {
            const response = await fetch('/api/analytics-insights', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildAnalyticsInsightPayload(analyticsSnapshotCurrent))
            });
            const raw = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(String(raw?.error || `Analytics request failed (${response.status})`));
            }
            const normalized = normalizeAnalyticsInsightsResult(raw, analyticsSnapshotCurrent);
            writeAnalyticsInsightsCache(signature, normalized);
            renderAnalyticsInsights(normalized, false);
            if (normalized.source !== 'deepseek') {
                showAlert('DeepSeek is unavailable right now, so a local fallback study plan was used.', 'error');
            }
        } catch (err) {
            console.warn('Analytics insights request failed:', err);
            const fallback = { source: 'fallback', insights: buildLocalAnalyticsInsights(analyticsSnapshotCurrent) };
            writeAnalyticsInsightsCache(signature, fallback);
            renderAnalyticsInsights(fallback, false);
            showAlert('Analytics AI request failed, so a local fallback study plan was generated.', 'error');
        }
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
        prepareAnalyticsInsights(snapshot, hasData);
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
    loadCoachWorkspace(false);
});
