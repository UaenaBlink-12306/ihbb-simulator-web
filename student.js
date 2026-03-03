document.addEventListener('DOMContentLoaded', async () => {
    const sb = window.supabaseClient;
    const guard = document.getElementById('auth-guard');
    if (!sb) { if (guard) guard.remove(); return; }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.replace('login.html'); return; }
    const uid = session.user.id;

    const { data: profile } = await sb.from('profiles').select('role, display_name').eq('id', uid).single();
    if (!profile || profile.role !== 'student') { window.location.replace('index.html'); return; }
    if (guard) guard.remove();

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
        document.getElementById('name-modal').classList.add('hidden');
        showAlert('Name saved!', 'success');
    });

    // ========== TAB SWITCHING ==========
    document.querySelectorAll('.dash-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });

    // ========== LOGOUT ==========
    document.getElementById('btn-logout').addEventListener('click', async (e) => {
        e.preventDefault(); await sb.auth.signOut(); window.location.replace('login.html');
    });

    // ========== DELETE ACCOUNT ==========
    document.getElementById('btn-delete-account').addEventListener('click', async () => {
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
                <button class="dash-btn danger" onclick="leaveClass('${cs.class_id}')">Leave</button>
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

    // ========== ASSIGNMENTS ==========
    async function loadAssignments() {
        const { data: memberships } = await sb.from('class_students').select('class_id').eq('student_id', uid);
        if (!memberships || !memberships.length) {
            document.getElementById('student-assignments').innerHTML = '<p class="muted">Join a class to see assignments.</p>';
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
        const el = document.getElementById('student-assignments');
        if (!list.length) { el.innerHTML = '<p class="muted">No assignments yet.</p>'; return; }
        el.innerHTML = list.map(a => {
            const due = a.due_date ? new Date(a.due_date).toLocaleDateString() : 'No deadline';
            const cls = a.classes?.name || '';
            const sub = subMap[a.id];
            let statusHtml;
            if (sub) {
                const pct = sub.total ? Math.round(sub.correct / sub.total * 100) : 0;
                statusHtml = `<span class="item-score ${pct >= 50 ? 'good' : 'bad'}">${sub.correct}/${sub.total} (${pct}%)</span>`;
            } else {
                statusHtml = `<button class="dash-btn primary" onclick="startAssignment('${a.id}', '${esc(a.title)}')">🎯 Start in Practice Hub</button>`;
            }
            return `<div class="list-item">
                <span class="item-title">${esc(a.title)}</span>
                <span class="item-meta">${esc(cls)} · Due: ${due}</span>
                ${statusHtml}
            </div>`;
        }).join('');
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
});
