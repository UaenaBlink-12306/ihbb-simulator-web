document.addEventListener('DOMContentLoaded', async () => {
    const sb = window.supabaseClient;
    const guard = document.getElementById('auth-guard');
    if (!sb) { if (guard) guard.remove(); return; }

    // Auth check
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.replace('login.html'); return; }
    const uid = session.user.id;

    // Profile check
    const { data: profile } = await sb
        .from('profiles')
        .select('role, display_name, class_code, created_at')
        .eq('id', uid)
        .single();
    if (!profile || profile.role !== 'teacher') { window.location.replace('index.html'); return; }
    if (guard) guard.remove();
    let userEmail = String(session.user?.email || '').trim();

    // State
    let allQuestions = [];
    let selectedQuestions = [];
    let myClasses = [];
    let currentMode = 'random';
    let selectedFilterCategories = [];
    let selectedFilterEras = [];

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
    const getEraLabel = (era) => ERA_LABELS[era] || era;
    const sortEraCodes = (codes) => (codes || []).slice().sort((a, b) => {
        const na = Number.parseInt(String(a), 10);
        const nb = Number.parseInt(String(b), 10);
        const aNum = Number.isFinite(na);
        const bNum = Number.isFinite(nb);
        if (aNum && bNum && na !== nb) return na - nb;
        if (aNum !== bNum) return aNum ? -1 : 1;
        return String(a).localeCompare(String(b));
    });
    const questionKey = (q) => {
        const explicit = String(q?.id || q?.question_id || '').trim();
        if (explicit) return explicit;
        const ans = String(q?.answer || q?.a || '').trim().toLowerCase();
        const ques = String(q?.question || q?.q || '').trim().toLowerCase();
        const cat = String(q?.meta?.category || q?.category || '').trim().toLowerCase();
        const era = String(q?.meta?.era || q?.era || '').trim().toLowerCase();
        return `${ans}::${ques}::${cat}::${era}`;
    };
    const dedupeQuestions = (list) => {
        const seen = new Set();
        const out = [];
        (list || []).forEach(q => {
            const key = questionKey(q);
            if (!key || seen.has(key)) return;
            seen.add(key);
            out.push(q);
        });
        return out;
    };
    const clampCount = (n, fallback = 10) => {
        const v = Number.parseInt(String(n || ''), 10);
        if (!Number.isFinite(v)) return fallback;
        return Math.max(1, Math.min(200, v));
    };

    // Load questions from questions.json
    try {
        const res = await fetch('questions.json');
        const json = await res.json();
        allQuestions = Array.isArray(json) ? json : (json.items || json.questions || json.sets?.[0]?.items || []);
    } catch { console.warn('Could not load questions.json'); }

    // Tab switching
    document.querySelectorAll('.dash-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('section.view').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            if (tab.dataset.tab === 'create') setMode(currentMode);
        });
    });

    // Mode switching (create assignment)
    const modeButtons = [...document.querySelectorAll('.mode-btn')];
    const modePanels = [...document.querySelectorAll('.mode-panel')];
    function setMode(mode) {
        currentMode = mode || 'random';
        modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === currentMode));
        modePanels.forEach(p => {
            p.classList.remove('active');
            p.classList.add('hidden');
        });
        const panel = document.getElementById('mode-' + currentMode);
        if (panel) {
            panel.classList.remove('hidden');
            panel.classList.add('active');
        }
    }
    modeButtons.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async (e) => {
        e.preventDefault(); await sb.auth.signOut(); window.location.replace('login.html');
    });

    // Account profile
    const saveAccountBtn = document.getElementById('btn-save-account');
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

    // Delete account
    document.getElementById('btn-delete-account').addEventListener('click', async () => {
        if (!confirm('⚠️ Permanently delete your account and ALL data?')) return;
        if (!confirm('FINAL WARNING: This cannot be undone!')) return;
        try { await sb.rpc('delete_user'); await sb.auth.signOut(); window.location.replace('login.html'); }
        catch (e) { alert('Delete failed: ' + e.message); }
    });

    // ========== CLASSES ==========
    async function loadClasses() {
        const { data, error } = await sb.from('classes').select('*').eq('teacher_id', uid).order('created_at', { ascending: false });
        myClasses = data || [];
        renderClasses();
        populateClassDropdown();
    }

    function renderClasses() {
        const el = document.getElementById('classes-list');
        if (!myClasses.length) { el.innerHTML = '<p class="muted">No classes yet. Create one to get started!</p>'; return; }
        el.innerHTML = myClasses.map(c => `
            <div class="list-item">
                <span class="item-title">${esc(c.name)}</span>
                <span class="item-badge">${c.code}</span>
                <button class="btn ghost" onclick="copyCode('${c.code}')">Copy Code</button>
                <button class="btn ghost" onclick="viewStudents('${c.id}')">Students</button>
                <button class="btn bad" onclick="deleteClass('${c.id}')">Delete</button>
            </div>
        `).join('');
    }

    window.copyCode = (code) => { navigator.clipboard.writeText(code).then(() => showAlert('Code copied: ' + code, 'success')); };

    // Modal helpers
    function showModal(title, bodyHtml) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = bodyHtml;
        document.getElementById('teacher-modal').classList.remove('hidden');
    }
    document.getElementById('modal-close').addEventListener('click', () => {
        document.getElementById('teacher-modal').classList.add('hidden');
    });
    document.getElementById('teacher-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) document.getElementById('teacher-modal').classList.add('hidden');
    });

    window.viewStudents = async (classId) => {
        const { data } = await sb.from('class_students').select('student_id, joined_at').eq('class_id', classId);
        if (!data || !data.length) { showModal('Enrolled Students', '<p class="muted">No students enrolled yet.</p>'); return; }
        const ids = data.map(s => s.student_id);
        const { data: profiles } = await sb.from('profiles').select('id, display_name').in('id', ids);
        const nameMap = {};
        (profiles || []).forEach(p => nameMap[p.id] = p.display_name || 'Unnamed');
        const html = data.map(s => `
            <div class="list-item">
                <span style="font-size: 20px;">👤</span>
                <span class="item-title">${esc(nameMap[s.student_id] || 'Unnamed')}</span>
                <span class="item-meta">Joined ${new Date(s.joined_at).toLocaleDateString()}</span>
                <a class="btn ghost" href="profile.html?user=${encodeURIComponent(s.student_id)}">Profile</a>
            </div>
        `).join('');
        showModal(`Enrolled Students (${data.length})`, html);
    };

    window.deleteClass = async (id) => {
        if (!confirm('Delete this class? All its assignments will also be deleted.')) return;
        await sb.from('classes').delete().eq('id', id);
        loadClasses(); loadAssignments();
    };

    document.getElementById('btn-new-class').addEventListener('click', () => {
        document.getElementById('new-class-form').classList.remove('hidden');
    });
    document.getElementById('btn-cancel-class').addEventListener('click', () => {
        document.getElementById('new-class-form').classList.add('hidden');
    });
    document.getElementById('btn-save-class').addEventListener('click', async () => {
        const name = document.getElementById('new-class-name').value.trim();
        if (!name) return;
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { error } = await sb.from('classes').insert({ teacher_id: uid, name, code });
        if (error) { showAlert(error.message, 'error'); return; }
        document.getElementById('new-class-form').classList.add('hidden');
        document.getElementById('new-class-name').value = '';
        showAlert('Class created with code: ' + code, 'success');
        loadClasses();
    });

    function populateClassDropdown() {
        const sel = document.getElementById('assign-class');
        sel.innerHTML = myClasses.map(c => `<option value="${c.id}">${esc(c.name)} (${c.code})</option>`).join('');
    }

    // ========== ASSIGNMENTS ==========
    async function loadAssignments() {
        const { data } = await sb.from('assignments').select('*, classes(name, code)').eq('teacher_id', uid).order('created_at', { ascending: false });
        renderAssignments(data || []);
    }

    function renderAssignments(list) {
        const el = document.getElementById('assignments-list');
        if (!list.length) { el.innerHTML = '<p class="muted">No assignments created yet.</p>'; return; }
        el.innerHTML = list.map(a => {
            const due = a.due_date ? new Date(a.due_date).toLocaleDateString() : 'No due date';
            const cls = a.classes ? a.classes.name : '';
            return `<div class="list-item">
                <span class="item-title">${esc(a.title)}</span>
                <span class="item-meta">${esc(cls)} · Due: ${due}</span>
                <button class="btn ghost" onclick="viewScores('${a.id}')">View Scores</button>
                <button class="btn bad" onclick="deleteAssignment('${a.id}')">Delete</button>
            </div>`;
        }).join('');
    }

    window.viewScores = async (assignId) => {
        // Get the assignment to find its class
        const { data: assign } = await sb.from('assignments').select('class_id').eq('id', assignId).single();
        // Get all students in the class
        const { data: classStudents } = await sb.from('class_students').select('student_id').eq('class_id', assign?.class_id);
        const allStudentIds = (classStudents || []).map(s => s.student_id);

        // Get submissions
        const { data: subs } = await sb.from('assignment_submissions').select('*').eq('assignment_id', assignId);
        const subMap = {};
        (subs || []).forEach(s => subMap[s.student_id] = s);

        // Fetch display names for all class students
        const { data: profiles } = await sb.from('profiles').select('id, display_name').in('id', allStudentIds);
        const nameMap = {};
        (profiles || []).forEach(p => nameMap[p.id] = p.display_name || 'Unnamed');

        if (!allStudentIds.length) { showModal('Submissions', '<p class="muted">No students in this class.</p>'); return; }

        const html = allStudentIds.map(sid => {
            const sub = subMap[sid];
            const name = nameMap[sid] || 'Unnamed';
            if (sub) {
                const pct = sub.total ? Math.round(sub.correct / sub.total * 100) : 0;
                return `<div class="list-item">
                    <span style="font-size: 20px;">👤</span>
                    <span class="item-title">${esc(name)}</span>
                    <span class="item-score ${pct >= 50 ? 'good' : 'bad'}">${sub.correct}/${sub.total} (${pct}%)</span>
                    <span class="status-pill done">✓ Completed</span>
                    <a class="btn ghost" href="profile.html?user=${encodeURIComponent(sid)}">Profile</a>
                </div>`;
            } else {
                return `<div class="list-item">
                    <span style="font-size: 20px;">👤</span>
                    <span class="item-title">${esc(name)}</span>
                    <span class="status-pill pending">⏳ Not Completed</span>
                    <a class="btn ghost" href="profile.html?user=${encodeURIComponent(sid)}">Profile</a>
                </div>`;
            }
        }).join('');
        const doneCount = Object.keys(subMap).length;
        showModal(`Submissions (${doneCount}/${allStudentIds.length} completed)`, html);
    };

    window.deleteAssignment = async (id) => {
        if (!confirm('Delete this assignment?')) return;
        await sb.from('assignments').delete().eq('id', id);
        loadAssignments();
    };

    // ========== CREATE ASSIGNMENT ==========
    // Populate filter chips
    const cats = [...new Set(allQuestions.map(q => q.meta?.category || q.category || '').filter(Boolean))]
        .sort((a, b) => String(a).localeCompare(String(b)));
    const eras = sortEraCodes([...new Set(allQuestions.map(q => q.meta?.era || q.era || '').filter(Boolean))]);
    function renderCategoryFilterChips() {
        const wrap = document.getElementById('filter-category-chips');
        if (!wrap) return;
        selectedFilterCategories = selectedFilterCategories.filter(c => cats.includes(c));
        wrap.innerHTML = '';
        const all = document.createElement('div');
        all.className = 'chip' + (selectedFilterCategories.length ? '' : ' active');
        all.textContent = 'All regions';
        all.addEventListener('click', () => {
            selectedFilterCategories = [];
            renderCategoryFilterChips();
        });
        wrap.appendChild(all);
        cats.forEach(c => {
            const chip = document.createElement('div');
            chip.className = 'chip' + (selectedFilterCategories.includes(c) ? ' active' : '');
            chip.textContent = c;
            chip.addEventListener('click', () => {
                const set = new Set(selectedFilterCategories);
                if (set.has(c)) set.delete(c); else set.add(c);
                selectedFilterCategories = Array.from(set);
                renderCategoryFilterChips();
            });
            wrap.appendChild(chip);
        });
    }
    function renderEraFilterChips() {
        const wrap = document.getElementById('filter-era-chips');
        if (!wrap) return;
        selectedFilterEras = selectedFilterEras.filter(e => eras.includes(e));
        wrap.innerHTML = '';
        const all = document.createElement('div');
        all.className = 'chip' + (selectedFilterEras.length ? '' : ' active');
        all.textContent = 'All eras';
        all.addEventListener('click', () => {
            selectedFilterEras = [];
            renderEraFilterChips();
        });
        wrap.appendChild(all);
        eras.forEach(e => {
            const chip = document.createElement('div');
            chip.className = 'chip' + (selectedFilterEras.includes(e) ? ' active' : '');
            chip.textContent = getEraLabel(e);
            chip.addEventListener('click', () => {
                const set = new Set(selectedFilterEras);
                if (set.has(e)) set.delete(e); else set.add(e);
                selectedFilterEras = Array.from(set);
                renderEraFilterChips();
            });
            wrap.appendChild(chip);
        });
    }
    renderCategoryFilterChips();
    renderEraFilterChips();

    function updatePreview() {
        const area = document.getElementById('preview-area');
        const count = document.getElementById('preview-count');
        const list = document.getElementById('preview-list');
        if (!selectedQuestions.length) { area.classList.add('hidden'); return; }
        area.classList.remove('hidden');
        count.textContent = selectedQuestions.length;
        list.innerHTML = selectedQuestions.slice(0, 50).map(q =>
            `<div class="p-item"><strong>${esc(q.answer || q.a || '')}</strong> — ${esc((q.question || q.q || '').substring(0, 80))}…</div>`
        ).join('');
    }
    function setSelectedQuestions(next) {
        selectedQuestions = dedupeQuestions(next);
        updatePreview();
    }
    function togglePickedQuestion(item, shouldSelect, rowEl) {
        const key = questionKey(item);
        const idx = selectedQuestions.findIndex(s => questionKey(s) === key);
        if (shouldSelect && idx < 0) selectedQuestions.push(item);
        if (!shouldSelect && idx >= 0) selectedQuestions.splice(idx, 1);
        if (rowEl) rowEl.classList.toggle('selected', !!shouldSelect);
        updatePreview();
    }
    document.getElementById('btn-clear-selection')?.addEventListener('click', () => {
        if (!selectedQuestions.length) return;
        selectedQuestions = [];
        updatePreview();
        if (currentMode === 'pick') {
            const search = document.getElementById('pick-search');
            if (search && search.value.trim().length >= 2) {
                search.dispatchEvent(new Event('input'));
            }
        }
        showAlert('Selection cleared.', 'success');
    });

    // Random
    document.getElementById('btn-random-preview').addEventListener('click', () => {
        if (!allQuestions.length) { showAlert('No questions loaded yet.', 'error'); return; }
        const n = clampCount(document.getElementById('random-count').value, 10);
        const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
        setSelectedQuestions(shuffled.slice(0, Math.min(n, allQuestions.length)));
    });

    // Filter
    document.getElementById('btn-filter-preview').addEventListener('click', () => {
        if (!allQuestions.length) { showAlert('No questions loaded yet.', 'error'); return; }
        const n = clampCount(document.getElementById('filter-count').value, 10);
        const catSet = new Set(selectedFilterCategories);
        const eraSet = new Set(selectedFilterEras);
        const pool = allQuestions.filter(q => {
            const cat = (q.meta?.category || q.category || '');
            const era = (q.meta?.era || q.era || '');
            if (catSet.size && !catSet.has(cat)) return false;
            if (eraSet.size && !eraSet.has(era)) return false;
            return true;
        });
        if (!pool.length) { showAlert('No questions match the selected regions/eras.', 'error'); return; }
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        setSelectedQuestions(shuffled.slice(0, Math.min(n, pool.length)));
    });
    document.getElementById('btn-filter-reset')?.addEventListener('click', () => {
        selectedFilterCategories = [];
        selectedFilterEras = [];
        renderCategoryFilterChips();
        renderEraFilterChips();
        showAlert('Filters cleared.', 'success');
    });

    // Hand Pick
    let pickDebounce;
    document.getElementById('pick-search').addEventListener('input', (e) => {
        clearTimeout(pickDebounce);
        pickDebounce = setTimeout(() => {
            const q = e.target.value.toLowerCase().trim();
            if (!q || q.length < 2) { document.getElementById('pick-results').innerHTML = ''; return; }
            const matches = allQuestions.filter(item => {
                const ans = (item.answer || item.a || '').toLowerCase();
                const ques = (item.question || item.q || '').toLowerCase();
                return ans.includes(q) || ques.includes(q);
            }).slice(0, 50);
            document.getElementById('pick-results').innerHTML = matches.map((item, i) => {
                const key = questionKey(item);
                const checked = selectedQuestions.some(s => questionKey(s) === key) ? 'checked' : '';
                return `<div class="pick-item ${checked ? 'selected' : ''}" data-idx="${i}" data-qkey="${esc(key)}">
                    <input type="checkbox" ${checked} data-qkey="${esc(key)}">
                    <strong>${esc(item.answer || item.a || '')}</strong>
                    <span class="muted" style="flex:1">${esc((item.question || item.q || '').substring(0, 60))}…</span>
                </div>`;
            }).join('');
            document.querySelectorAll('.pick-item').forEach(el => {
                const idx = parseInt(el.dataset.idx, 10);
                const item = matches[idx];
                const cb = el.querySelector('input[type=checkbox]');
                cb.addEventListener('change', () => {
                    togglePickedQuestion(item, cb.checked, el);
                });
                el.addEventListener('click', (evt) => {
                    if (evt.target && evt.target.matches('input[type=checkbox]')) return;
                    const cb = el.querySelector('input[type=checkbox]');
                    cb.checked = !cb.checked;
                    togglePickedQuestion(item, cb.checked, el);
                });
            });
        }, 300);
    });

    // Create
    document.getElementById('btn-create-assignment').addEventListener('click', async () => {
        const title = document.getElementById('assign-title').value.trim();
        const classId = document.getElementById('assign-class').value;
        const due = document.getElementById('assign-due').value || null;
        const instructions = document.getElementById('assign-instructions').value.trim();

        if (!title) return showAlert('Title is required.', 'error');
        if (!classId) return showAlert('Select a class.', 'error');
        if (!selectedQuestions.length) return showAlert('Select some questions first.', 'error');

        const btn = document.getElementById('btn-create-assignment');
        btn.disabled = true; btn.textContent = 'Creating...';

        try {
            const { data: assignment, error } = await sb.from('assignments').insert({
                class_id: classId, teacher_id: uid, title,
                instructions, due_date: due ? new Date(due).toISOString() : null
            }).select().single();
            if (error) throw error;

            const questions = selectedQuestions.map(q => ({
                assignment_id: assignment.id,
                question_id: questionKey(q),
                question_text: q.question || q.q || '',
                answer_text: q.answer || q.a || '',
                category: q.meta?.category || q.category || '',
                era: q.meta?.era || q.era || ''
            }));
            await sb.from('assignment_questions').insert(questions);

            showAlert('Assignment created successfully!', 'success');
            selectedQuestions = [];
            updatePreview();
            document.getElementById('assign-title').value = '';
            document.getElementById('assign-instructions').value = '';
            loadAssignments();

            // Switch to assignments tab
            document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('section.view').forEach(c => c.classList.remove('active'));
            document.querySelector('[data-tab="assignments"]').classList.add('active');
            document.getElementById('tab-assignments').classList.add('active');
        } catch (e) {
            showAlert('Failed: ' + e.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = '📝 Create Assignment';
        }
    });

    // Helpers
    function showAlert(msg, type = 'error') {
        const el = document.getElementById('alert-box');
        el.textContent = msg; el.className = `alert ${type}`; el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 4000);
    }
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    // Init
    setMode(modeButtons.find(b => b.classList.contains('active'))?.dataset.mode || 'random');
    loadClasses();
    loadAssignments();
});
