document.addEventListener('DOMContentLoaded', async () => {
    const sb = window.supabaseClient;
    const guard = document.getElementById('auth-guard');
    const alertBox = document.getElementById('alert-box');
    const STUDY_DATA_RESET_CUTOFF_ISO = '2026-04-10T02:07:20Z';

    const showAlert = (msg, type = 'error') => {
        if (!alertBox) return;
        alertBox.textContent = msg;
        alertBox.className = `alert ${type}`;
        alertBox.classList.remove('hidden');
    };
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? '';
    };
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value ?? '';
    };
    const avatarCatalog = window.AvatarCatalog || {};
    const normalizeAvatarId = (value) => {
        if (typeof avatarCatalog.normalizeAvatarId === 'function') return avatarCatalog.normalizeAvatarId(value);
        return 'penguin';
    };
    const avatarLabel = (value) => {
        if (typeof avatarCatalog.avatarLabel === 'function') return avatarCatalog.avatarLabel(value);
        return 'Penguin';
    };
    const applyAvatarImage = (img, value, altText) => {
        if (!img) return;
        if (typeof avatarCatalog.applyAvatarImage === 'function') {
            avatarCatalog.applyAvatarImage(img, value, altText);
            return;
        }
        img.alt = altText || 'Profile avatar';
        img.src = `/assets/avatars/${normalizeAvatarId(value)}.png`;
    };
    const formatRole = (role) => {
        const s = String(role || '').trim().toLowerCase();
        if (!s) return 'Unknown';
        return s.charAt(0).toUpperCase() + s.slice(1);
    };
    const formatCount = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num.toLocaleString() : '0';
    };
    const formatPercent = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? `${Math.round(num)}%` : '—';
    };
    const formatDuration = (seconds) => {
        const num = Number(seconds);
        if (!Number.isFinite(num) || num <= 0) return '—';
        if (num < 60) return `${Math.round(num)}s`;
        const minutes = Math.floor(num / 60);
        const remainder = Math.round(num % 60);
        return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
    };
    const toTimestamp = (value) => {
        if (value === null || value === undefined || value === '') return 0;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        const numeric = Number(value);
        if (Number.isFinite(numeric) && String(value).trim() !== '') return numeric;
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    const latestTimestamp = (rows, fields) => {
        let latest = 0;
        (rows || []).forEach((row) => {
            fields.forEach((field) => {
                const ts = toTimestamp(row?.[field]);
                if (ts > latest) latest = ts;
            });
        });
        return latest;
    };
    const sumField = (rows, field) => (rows || []).reduce((total, row) => total + (Number(row?.[field]) || 0), 0);
    const averageField = (rows, field) => {
        const list = Array.isArray(rows) ? rows : [];
        if (!list.length) return null;
        const total = sumField(list, field);
        return total / list.length;
    };
    async function safeSelect(table, columns, queryBuilder) {
        try {
            let query = sb.from(table).select(columns, { count: 'exact' });
            if (typeof queryBuilder === 'function') query = queryBuilder(query);
            const { data, count, error } = await query;
            if (error) throw error;
            return {
                rows: Array.isArray(data) ? data : [],
                count: Number.isFinite(count) ? count : (Array.isArray(data) ? data.length : 0),
                error: null
            };
        } catch (error) {
            return { rows: [], count: 0, error };
        }
    }
    function renderAnalyticsSummary(summary) {
        setText('pf-analytics-overall-accuracy', summary.overallAccuracy === null ? '—' : formatPercent(summary.overallAccuracy));
        setText('pf-analytics-overall-accuracy-note', summary.totalAnswers > 0
            ? `Weighted across ${formatCount(summary.totalAnswers)} graded answers.`
            : 'No graded answers yet.');
        setText('pf-analytics-total-answers', formatCount(summary.totalAnswers));
        setText('pf-analytics-total-answers-note', summary.totalAnswers > 0
            ? (summary.sourceLabels.length ? summary.sourceLabels.join(' + ') : 'Stored activity')
            : 'Sessions + assignments');
        setText('pf-analytics-sessions', formatCount(summary.practiceSessions));
        setText('pf-analytics-sessions-note', summary.practiceSessions > 0
            ? `Avg session length: ${formatDuration(summary.avgSessionDuration)}${summary.sessionAccuracy === null ? '' : ` • Accuracy ${formatPercent(summary.sessionAccuracy)}`}`
            : 'No practice sessions yet.');
        setText('pf-analytics-assignment-accuracy', summary.assignmentAccuracy === null ? '—' : formatPercent(summary.assignmentAccuracy));
        setText('pf-analytics-assignment-note', summary.assignmentSubmissions > 0
            ? `${formatCount(summary.assignmentSubmissions)} submissions${summary.assignmentAccuracy === null ? '' : ` • Accuracy ${formatPercent(summary.assignmentAccuracy)}`}`
            : '0 submissions');
        setText('pf-analytics-wrong-bank', formatCount(summary.wrongBankRows));
        setText('pf-analytics-coach-attempts', formatCount(summary.coachAttempts));
        setText('pf-analytics-class-memberships', formatCount(summary.classMemberships));
        setText('pf-analytics-latest-activity', summary.latestActivity ? new Date(summary.latestActivity).toLocaleString() : '—');
        const noteParts = ['Read-only summary from stored practice data.'];
        if (summary.sourceLabels.length) noteParts.push(`Sources: ${summary.sourceLabels.join(', ')}.`);
        if (summary.errors.length) noteParts.push('Some sources were unavailable with the current permissions.');
        if (!summary.sourceLabels.length && !summary.errors.length) noteParts.push('No stored analytics rows were found yet.');
        setText('pf-analytics-note', noteParts.join(' '));
    }
    async function loadProfileAnalytics(targetUserId) {
        const [sessions, submissions, wrongBank, coachAttempts, classMemberships] = await Promise.all([
            safeSelect('user_drill_sessions', 'correct, total, dur, ts, created_at', (query) =>
                query.eq('user_id', targetUserId).gte('created_at', STUDY_DATA_RESET_CUTOFF_ISO).order('created_at', { ascending: false })
            ),
            safeSelect('assignment_submissions', 'correct, total, submitted_at, created_at', (query) =>
                query.eq('student_id', targetUserId).order('submitted_at', { ascending: false })
            ),
            safeSelect('user_wrong_questions', 'created_at', (query) =>
                query.eq('user_id', targetUserId).gte('created_at', STUDY_DATA_RESET_CUTOFF_ISO).order('created_at', { ascending: false })
            ),
            safeSelect('user_coach_attempts', 'created_at', (query) =>
                query.eq('user_id', targetUserId).gte('created_at', STUDY_DATA_RESET_CUTOFF_ISO).order('created_at', { ascending: false })
            ),
            safeSelect('class_students', 'joined_at', (query) =>
                query.eq('student_id', targetUserId).order('joined_at', { ascending: false })
            )
        ]);

        const errors = [sessions.error, submissions.error, wrongBank.error, coachAttempts.error, classMemberships.error].filter(Boolean);
        const sessionCorrect = sumField(sessions.rows, 'correct');
        const sessionTotal = sumField(sessions.rows, 'total');
        const assignmentCorrect = sumField(submissions.rows, 'correct');
        const assignmentTotal = sumField(submissions.rows, 'total');
        const totalAnswers = sessionTotal + assignmentTotal;
        const totalCorrect = sessionCorrect + assignmentCorrect;
        const overallAccuracy = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : null;
        const practiceSessions = sessions.count || sessions.rows.length;
        const assignmentSubmissions = submissions.count || submissions.rows.length;
        const wrongBankRows = wrongBank.count || wrongBank.rows.length;
        const coachAttemptsCount = coachAttempts.count || coachAttempts.rows.length;
        const classMembershipCount = classMemberships.count || classMemberships.rows.length;
        const sessionAccuracy = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : null;
        const assignmentAccuracy = assignmentTotal > 0 ? Math.round((assignmentCorrect / assignmentTotal) * 100) : null;
        const avgSessionDuration = averageField(sessions.rows, 'dur');
        const latestActivity = Math.max(
            latestTimestamp(sessions.rows, ['ts', 'created_at']),
            latestTimestamp(submissions.rows, ['submitted_at', 'created_at']),
            latestTimestamp(wrongBank.rows, ['created_at']),
            latestTimestamp(coachAttempts.rows, ['created_at']),
            latestTimestamp(classMemberships.rows, ['joined_at'])
        );

        return {
            overallAccuracy,
            totalAnswers,
            practiceSessions,
            sessionAccuracy,
            avgSessionDuration,
            assignmentSubmissions,
            assignmentAccuracy,
            wrongBankRows,
            coachAttempts: coachAttemptsCount,
            classMemberships: classMembershipCount,
            latestActivity: latestActivity || null,
            sourceLabels: [
                sessions.rows.length ? 'drill sessions' : '',
                submissions.rows.length ? 'assignments' : '',
                wrongBank.rows.length ? 'wrong-bank' : '',
                coachAttempts.rows.length ? 'coach attempts' : '',
                classMemberships.rows.length ? 'class enrollments' : ''
            ].filter(Boolean),
            errors
        };
    }

    if (!sb) {
        if (guard) guard.remove();
        showAlert('Supabase is not available.', 'error');
        return;
    }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        window.location.replace('login.html');
        return;
    }
    const viewerId = session.user.id;

    const { data: viewerProfile, error: viewerErr } = await sb
        .from('profiles')
        .select('*')
        .eq('id', viewerId)
        .single();

    if (viewerErr || !viewerProfile || !viewerProfile.role) {
        window.location.replace('onboarding.html');
        return;
    }

    const backHref = viewerProfile.role === 'teacher' ? 'teacher.html' : 'student.html';
    const backBtn = document.getElementById('btn-back-dashboard');
    if (backBtn) backBtn.href = backHref;

    document.getElementById('btn-logout')?.addEventListener('click', async (e) => {
        e.preventDefault();
        await sb.auth.signOut();
        window.location.replace('login.html');
    });

    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('user');
    let targetId = requestedId || viewerId;

    const { data: targetProfile, error: targetErr } = await sb
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .single();

    if (targetErr || !targetProfile) {
        if (guard) guard.remove();
        showAlert('Profile not found or you do not have access to view it.', 'error');
        return;
    }

    const isOwnProfile = targetProfile.id === viewerId;
    const heading = document.getElementById('profile-heading');
    const title = document.getElementById('profile-title');
    const subtitle = document.getElementById('profile-subtitle');

    if (isOwnProfile) {
        if (heading) heading.textContent = 'My Profile';
        if (title) title.textContent = 'My Profile';
        if (subtitle) subtitle.textContent = 'Basic profile info plus a read-only performance summary from stored practice data.';
    } else {
        const name = targetProfile.display_name || 'Student';
        if (heading) heading.textContent = `${name}'s Profile`;
        if (title) title.textContent = `${name}'s Profile`;
        if (subtitle) subtitle.textContent = 'Teacher view of this profile plus a read-only performance summary from stored practice data.';
    }

    setValue('pf-display-name', targetProfile.display_name || 'Unnamed');
    setValue('pf-role', formatRole(targetProfile.role));
    setValue('pf-class-code', targetProfile.class_code || '—');
    setValue('pf-school-name', targetProfile.school_name || '—');
    setValue('pf-created-at', targetProfile.created_at ? new Date(targetProfile.created_at).toLocaleString() : '—');
    setValue('pf-user-id', targetProfile.id || '—');

    const resolvedAvatarId = normalizeAvatarId(targetProfile.avatar_id);
    const avatarImg = document.getElementById('pf-avatar-image');
    const avatarLabelEl = document.getElementById('pf-avatar-label');
    applyAvatarImage(avatarImg, resolvedAvatarId, `${avatarLabel(resolvedAvatarId)} avatar`);
    if (avatarLabelEl) avatarLabelEl.textContent = avatarLabel(resolvedAvatarId);

    renderAnalyticsSummary(await loadProfileAnalytics(targetProfile.id));

    if (guard) guard.remove();
});
