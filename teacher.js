document.addEventListener('DOMContentLoaded', async () => {
    const sb = window.supabaseClient;
    const guard = document.getElementById('auth-guard');
    if (!sb) { if (guard) guard.remove(); return; }

    // Auth check
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.replace('login.html'); return; }
    const uid = session.user.id;

    // Profile check
    const { data: profile } = await sb.from('profiles').select('role').eq('id', uid).single();
    if (!profile || profile.role !== 'teacher') { window.location.replace('index.html'); return; }
    if (guard) guard.remove();

    // State
    let allQuestions = [];
    let selectedQuestions = [];
    let myClasses = [];

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
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });

    // Mode switching (create assignment)
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.mode-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('mode-' + btn.dataset.mode).classList.add('active');
        });
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async (e) => {
        e.preventDefault(); await sb.auth.signOut(); window.location.replace('login.html');
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
                <button class="dash-btn ghost" onclick="copyCode('${c.code}')">Copy Code</button>
                <button class="dash-btn ghost" onclick="viewStudents('${c.id}')">Students</button>
                <button class="dash-btn danger" onclick="deleteClass('${c.id}')">Delete</button>
            </div>
        `).join('');
    }

    window.copyCode = (code) => { navigator.clipboard.writeText(code).then(() => showAlert('Code copied: ' + code, 'success')); };

    window.viewStudents = async (classId) => {
        const { data } = await sb.from('class_students').select('student_id, joined_at').eq('class_id', classId);
        if (!data || !data.length) { alert('No students enrolled yet.'); return; }
        const lines = data.map((s, i) => `${i + 1}. Student ID: ${s.student_id.substring(0, 8)}... (joined ${new Date(s.joined_at).toLocaleDateString()})`);
        alert('Enrolled Students:\n' + lines.join('\n'));
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
                <button class="dash-btn ghost" onclick="viewScores('${a.id}')">View Scores</button>
                <button class="dash-btn danger" onclick="deleteAssignment('${a.id}')">Delete</button>
            </div>`;
        }).join('');
    }

    window.viewScores = async (assignId) => {
        const { data } = await sb.from('assignment_submissions').select('*').eq('assignment_id', assignId);
        if (!data || !data.length) { alert('No submissions yet.'); return; }
        const lines = data.map((s, i) => `${i + 1}. ${s.student_id.substring(0, 8)}... → ${s.correct}/${s.total} (${s.total ? Math.round(s.correct / s.total * 100) : 0}%)`);
        alert('Submissions:\n' + lines.join('\n'));
    };

    window.deleteAssignment = async (id) => {
        if (!confirm('Delete this assignment?')) return;
        await sb.from('assignments').delete().eq('id', id);
        loadAssignments();
    };

    // ========== CREATE ASSIGNMENT ==========
    // Populate filter dropdowns
    const cats = [...new Set(allQuestions.map(q => q.meta?.category || q.category || '').filter(Boolean))];
    const eras = [...new Set(allQuestions.map(q => q.meta?.era || q.era || '').filter(Boolean))];
    const catSel = document.getElementById('filter-category');
    const eraSel = document.getElementById('filter-era-select');
    cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o); });
    eras.forEach(e => { const o = document.createElement('option'); o.value = e; o.textContent = e; eraSel.appendChild(o); });

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

    // Random
    document.getElementById('btn-random-preview').addEventListener('click', () => {
        const n = parseInt(document.getElementById('random-count').value) || 10;
        const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
        selectedQuestions = shuffled.slice(0, Math.min(n, allQuestions.length));
        updatePreview();
    });

    // Filter
    document.getElementById('btn-filter-preview').addEventListener('click', () => {
        const cat = document.getElementById('filter-category').value;
        const era = document.getElementById('filter-era-select').value;
        const n = parseInt(document.getElementById('filter-count').value) || 10;
        let pool = allQuestions.filter(q => {
            if (cat && (q.meta?.category || q.category || '') !== cat) return false;
            if (era && (q.meta?.era || q.era || '') !== era) return false;
            return true;
        });
        const shuffled = pool.sort(() => Math.random() - 0.5);
        selectedQuestions = shuffled.slice(0, Math.min(n, pool.length));
        updatePreview();
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
                const id = item.id || i;
                const checked = selectedQuestions.some(s => (s.id || '') === (item.id || '')) ? 'checked' : '';
                return `<div class="pick-item ${checked ? 'selected' : ''}" data-idx="${i}">
                    <input type="checkbox" ${checked} data-qid="${id}">
                    <strong>${esc(item.answer || item.a || '')}</strong>
                    <span class="muted" style="flex:1">${esc((item.question || item.q || '').substring(0, 60))}…</span>
                </div>`;
            }).join('');
            document.querySelectorAll('.pick-item').forEach(el => {
                el.addEventListener('click', () => {
                    const cb = el.querySelector('input[type=checkbox]');
                    cb.checked = !cb.checked;
                    const idx = parseInt(el.dataset.idx);
                    const item = matches[idx];
                    if (cb.checked) {
                        if (!selectedQuestions.some(s => s.id === item.id)) selectedQuestions.push(item);
                        el.classList.add('selected');
                    } else {
                        selectedQuestions = selectedQuestions.filter(s => s.id !== item.id);
                        el.classList.remove('selected');
                    }
                    updatePreview();
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
                question_id: q.id || '',
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
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
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
    loadClasses();
    loadAssignments();
});
