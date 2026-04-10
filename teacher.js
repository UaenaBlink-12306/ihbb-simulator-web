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
        .select('*')
        .eq('id', uid)
        .single();
    if (!profile || profile.role !== 'teacher') { window.location.replace('index.html'); return; }
    if (guard) guard.remove();
    let userEmail = String(session.user?.email || '').trim();
    const STUDY_DATA_RESET_CUTOFF_ISO = '2026-04-10T02:07:20Z';
    const avatarCatalog = window.AvatarCatalog || {};
    const avatarOptions = Array.isArray(avatarCatalog.AVATAR_OPTIONS) && avatarCatalog.AVATAR_OPTIONS.length
        ? avatarCatalog.AVATAR_OPTIONS
        : [{ id: 'penguin', label: 'Penguin' }];
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
        img.alt = altText || 'Avatar';
        img.src = `/assets/avatars/${normalizeAvatarId(value)}.png`;
    };
    const avatarAssetPath = (value) => {
        if (typeof avatarCatalog.avatarAssetPath === 'function') return avatarCatalog.avatarAssetPath(value);
        return `/assets/avatars/${normalizeAvatarId(value)}.png`;
    };
    const userAvatarHtml = (value, name) => {
        const resolvedAvatarId = normalizeAvatarId(value);
        return `<span style="align-self:center;width:44px;height:44px;flex:0 0 auto;display:inline-grid;place-items:center;overflow:hidden;border-radius:16px;border:1px solid rgba(125,211,252,0.48);background:radial-gradient(circle at 30% 24%, rgba(255,255,255,0.62), transparent 34%), linear-gradient(180deg, #dff4ff, #b8e2ff);box-shadow:inset 0 1px 0 rgba(255,255,255,0.6), 0 14px 24px -24px rgba(8,47,73,0.45);"><img data-avatar-id="${esc(resolvedAvatarId)}" src="${esc(avatarAssetPath(resolvedAvatarId))}" alt="${esc(name || 'User')} avatar" style="width:80%;height:80%;display:block;object-fit:contain;transform:scale(1.12);transform-origin:center;"></span>`;
    };
    const hydrateAvatarImages = (root) => {
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        scope.querySelectorAll('img[data-avatar-id]').forEach((img) => {
            applyAvatarImage(img, img.dataset.avatarId, img.alt || 'Avatar');
        });
    };
    let selectedAvatarId = normalizeAvatarId(profile.avatar_id);

    // State
    let allQuestions = [];
    let selectedQuestions = [];
    let myClasses = [];
    let currentMode = 'random';
    let selectedFilterCategories = [];
    let selectedFilterEras = [];
    let generatedDraftQuestions = [];
    const GENERATED_QUESTIONS_TABLE = 'generated_questions';

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
    const normalizeQuestionRecord = (raw) => {
        if (!raw || typeof raw !== 'object') return null;
        const question = String(raw.question || raw.q || raw.question_text || '').trim();
        const answer = String(raw.answer || raw.a || raw.answer_text || '').trim();
        if (!question || !answer) return null;
        return {
            id: String(raw.id || raw.question_id || '').trim() || questionKey(raw),
            question,
            answer,
            aliases: Array.isArray(raw.aliases) ? raw.aliases.map(a => String(a || '').trim()).filter(Boolean) : [],
            topic: String(raw.topic || '').trim(),
            meta: {
                category: String(raw.meta?.category || raw.category || '').trim(),
                era: String(raw.meta?.era || raw.era || '').trim(),
                source: String(raw.meta?.source || raw.source || '').trim()
            }
        };
    };
    const updateGeneratorStatus = (message, type = 'muted') => {
        const el = document.getElementById('teacher-gen-status');
        if (!el) return;
        el.className = `section-subtitle ${type === 'error' ? 'text-bad' : ''}`.trim();
        el.textContent = message;
    };
    const renderGeneratedDraftPreview = () => {
        const wrap = document.getElementById('teacher-gen-preview');
        const addBtn = document.getElementById('btn-teacher-add-draft');
        if (!wrap || !addBtn) return;
        addBtn.disabled = !generatedDraftQuestions.length;
        if (!generatedDraftQuestions.length) {
            wrap.classList.add('hidden');
            wrap.innerHTML = '';
            return;
        }
        wrap.classList.remove('hidden');
        wrap.innerHTML = generatedDraftQuestions.map((q, index) => `
            <div class="generator-item">
                <div class="generator-item-head">
                    <strong>${esc(q.answer || '')}</strong>
                    <span class="pill">${esc(q.meta?.category || 'World')}${q.meta?.era ? ` • ${esc(getEraLabel(q.meta.era))}` : ''}${q.meta?.source ? ` • ${esc(q.meta.source)}` : ''}</span>
                </div>
                <p>${esc(q.question || '')}</p>
                <div class="generator-item-meta">Draft ${index + 1}${q.topic ? ` • ${esc(q.topic)}` : ''}</div>
            </div>
        `).join('');
    };
    const populateGeneratorControls = () => {
        const regionSel = document.getElementById('teacher-gen-region');
        const eraSel = document.getElementById('teacher-gen-era');
        if (regionSel) {
            const categories = [...new Set(allQuestions.map(q => q.meta?.category || q.category || '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
            regionSel.innerHTML = '<option value="">World / Mixed</option>' + categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        }
        if (eraSel) {
            const eras = sortEraCodes([...new Set(allQuestions.map(q => q.meta?.era || q.era || '').filter(Boolean))]);
            eraSel.innerHTML = '<option value="">Any era</option>' + eras.map(e => `<option value="${esc(e)}">${esc(getEraLabel(e))}</option>`).join('');
        }
    };
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
    const teacherAnalyticsState = {
        loading: false,
        error: '',
        selectedClassId: '',
        classes: [],
        byClassId: new Map(),
        totals: null
    };
    let teacherAnalyticsLoadVersion = 0;
    const toNum = (value, fallback = 0) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    };
    const toTs = (value) => {
        if (value === null || value === undefined || value === '') return 0;
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
        const parsed = Date.parse(String(value));
        return Number.isFinite(parsed) ? parsed : 0;
    };
    const formatPct = (value, digits = 0) => {
        if (value === null || value === undefined || value === '') return '—';
        const n = Number(value);
        return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
    };
    const formatCount = (value, label) => `${value} ${label}${value === 1 ? '' : 's'}`;
    const sumBy = (list, getter) => (list || []).reduce((total, item) => total + toNum(getter(item), 0), 0);
    const uniqueValues = (list) => [...new Set((list || []).filter(Boolean))];
    const groupBy = (list, getter) => {
        const map = new Map();
        (list || []).forEach((item) => {
            const key = getter(item);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
        });
        return map;
    };
    const renderStudentList = (containerId, rows, emptyCopy) => {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (!rows || !rows.length) {
            el.innerHTML = `<p class="muted">${esc(emptyCopy)}</p>`;
            return;
        }
        el.innerHTML = rows.map((row) => {
            const score = Number.isFinite(row.avgAssignmentScore) ? `${row.avgAssignmentScore}%` : '—';
            const scoreClass = Number.isFinite(row.avgAssignmentScore)
                ? (row.avgAssignmentScore >= 80 ? 'good' : (row.avgAssignmentScore < 65 ? 'bad' : ''))
                : '';
            const detailBits = [
                row.submissionCount ? `${formatCount(row.submissionCount, 'submission')}` : 'No submissions yet',
                Number.isFinite(row.completionRate) ? `${row.completionRate}% completion` : 'No assignment completion yet',
                row.sessionCount ? `${formatCount(row.sessionCount, 'session')}` : 'No sessions yet',
                row.wrongCount ? `${formatCount(row.wrongCount, 'wrong-bank row')}` : 'No wrong-bank rows',
                row.coachCount ? `${formatCount(row.coachCount, 'coach attempt')}` : 'No coach attempts'
            ];
            return `
                <div class="list-item">
                    ${userAvatarHtml(row.avatarId || '', row.name || 'Unnamed')}
                    <div class="item-copy">
                        <span class="item-title">${esc(row.name || 'Unnamed')}</span>
                        <span class="item-meta">${esc(detailBits.join(' • '))}</span>
                    </div>
                    <span class="item-score ${scoreClass}">${esc(score)}</span>
                </div>
            `;
        }).join('');
        hydrateAvatarImages(el);
    };
    const buildClassSummaryList = (stats) => {
        if (!stats) {
            return `
                <div class="summary-item">
                    <span>Roster</span>
                    <strong>Select a class to view the numbers.</strong>
                </div>
            `;
        }
        const score = Number.isFinite(stats.avgAssignmentScore) ? `${stats.avgAssignmentScore}% avg score` : 'No scored submissions yet';
        const completion = Number.isFinite(stats.completionRate) ? `${stats.completionRate}% completion` : 'No assignment submissions yet';
        const activity = `${stats.activeStudentCount}/${stats.studentCount} active students`;
        const practice = `${formatCount(stats.sessionCount, 'practice session')}${stats.avgSessionAccuracy !== null ? ` • ${stats.avgSessionAccuracy}% session accuracy` : ''}`;
        return `
            <div class="summary-item">
                <span>Roster</span>
                <strong>${esc(formatCount(stats.studentCount, 'student'))} across ${formatCount(stats.assignmentCount, 'assignment')}</strong>
            </div>
            <div class="summary-item">
                <span>Submissions</span>
                <strong>${esc(score)} • ${esc(completion)}</strong>
            </div>
            <div class="summary-item">
                <span>Practice</span>
                <strong>${esc(practice)}</strong>
            </div>
            <div class="summary-item">
                <span>Engagement</span>
                <strong>${esc(activity)} • ${formatCount(stats.wrongCount, 'wrong-bank row')} • ${formatCount(stats.coachCount, 'coach attempt')}</strong>
            </div>
        `;
    };
    const buildClassMetaLine = (stats) => {
        if (!stats) return 'Invite code ready to share with the next roster.';
        const parts = [
            formatCount(stats.studentCount, 'student'),
            formatCount(stats.assignmentCount, 'assignment')
        ];
        if (Number.isFinite(stats.avgAssignmentScore)) parts.push(`${stats.avgAssignmentScore}% avg score`);
        if (Number.isFinite(stats.completionRate)) parts.push(`${stats.completionRate}% completion`);
        return parts.join(' • ');
    };
    const selectAnalyticsClass = (classId) => {
        const nextId = String(classId || '').trim();
        if (nextId) teacherAnalyticsState.selectedClassId = nextId;
        renderTeacherAnalytics();
    };
    window.selectAnalyticsClass = selectAnalyticsClass;
    window.openClassAnalytics = (classId) => {
        selectAnalyticsClass(classId);
        document.querySelector('[data-tab="analytics"]')?.click();
    };
    function normalizeTeacherAnalyticsClassRows(classRows, rosterRows, assignmentRows, submissionRows, sessionRows, wrongRows, coachRows, profileRows) {
        const rosterByClass = groupBy(rosterRows, row => String(row.class_id || ''));
        const assignmentsByClass = groupBy(assignmentRows, row => String(row.class_id || ''));
        const submissionsByAssignment = groupBy(submissionRows, row => String(row.assignment_id || ''));
        const sessionsByStudent = groupBy(sessionRows, row => String(row.user_id || ''));
        const wrongByStudent = groupBy(wrongRows, row => String(row.user_id || ''));
        const coachByStudent = groupBy(coachRows, row => String(row.user_id || ''));
        const profileById = new Map((profileRows || []).map((row) => [String(row.id || ''), row]));

        const classStats = (classRows || []).map((classRow) => {
            const classId = String(classRow.id || '');
            const roster = rosterByClass.get(classId) || [];
            const assignmentList = assignmentsByClass.get(classId) || [];
            const submissions = assignmentList.length
                ? assignmentList.flatMap((assignment) => submissionsByAssignment.get(String(assignment.id || '')) || [])
                : [];
            const submissionsByStudent = groupBy(submissions, row => String(row.student_id || ''));
            const studentIds = uniqueValues(roster.map((row) => String(row.student_id || '')).filter(Boolean));
            const assignmentCount = assignmentList.length;
            const studentRows = studentIds.map((studentId) => {
                const profile = profileById.get(studentId) || {};
                const studentSubmissions = submissionsByStudent.get(studentId) || [];
                const studentSessions = sessionsByStudent.get(studentId) || [];
                const studentWrong = wrongByStudent.get(studentId) || [];
                const studentCoach = coachByStudent.get(studentId) || [];
                const submissionCorrect = sumBy(studentSubmissions, row => row.correct);
                const submissionTotal = sumBy(studentSubmissions, row => row.total);
                const sessionCorrect = sumBy(studentSessions, row => row.correct);
                const sessionTotal = sumBy(studentSessions, row => row.total);
                const completionRate = assignmentCount
                    ? Math.round((studentSubmissions.length / assignmentCount) * 100)
                    : null;
                const lastActivity = Math.max(
                    ...studentSubmissions.map(row => toTs(row.submitted_at || row.created_at)),
                    ...studentSessions.map(row => toTs(row.ts || row.created_at)),
                    ...studentWrong.map(row => toTs(row.created_at)),
                    ...studentCoach.map(row => toTs(row.created_at)),
                    0
                );
                return {
                    id: studentId,
                    name: String(profile.display_name || 'Unnamed'),
                    avatarId: normalizeAvatarId(profile.avatar_id),
                    submissionCount: studentSubmissions.length,
                    completionRate,
                    avgAssignmentScore: submissionTotal > 0 ? Math.round((submissionCorrect / submissionTotal) * 100) : null,
                    sessionCount: studentSessions.length,
                    avgSessionAccuracy: sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : null,
                    wrongCount: studentWrong.length,
                    coachCount: studentCoach.length,
                    lastActivity,
                    engagementScore: studentSubmissions.length * 3 + studentSessions.length * 2 + studentWrong.length + studentCoach.length
                };
            }).sort((a, b) => {
                const aScore = Number.isFinite(a.avgAssignmentScore) ? a.avgAssignmentScore : -1;
                const bScore = Number.isFinite(b.avgAssignmentScore) ? b.avgAssignmentScore : -1;
                if (bScore !== aScore) return bScore - aScore;
                const aCompletion = Number.isFinite(a.completionRate) ? a.completionRate : -1;
                const bCompletion = Number.isFinite(b.completionRate) ? b.completionRate : -1;
                if (bCompletion !== aCompletion) return bCompletion - aCompletion;
                if (b.engagementScore !== a.engagementScore) return b.engagementScore - a.engagementScore;
                return a.name.localeCompare(b.name);
            });

            const submissionCount = submissions.length;
            const totalCorrect = sumBy(submissions, row => row.correct);
            const totalPossible = sumBy(submissions, row => row.total);
            const studentCount = studentIds.length;
            const completionRate = studentCount && assignmentCount
                ? Math.round((submissionCount / (studentCount * assignmentCount)) * 100)
                : null;
            const avgAssignmentScore = totalPossible > 0 ? Math.round((totalCorrect / totalPossible) * 100) : null;
            const sessionCount = sumBy(studentRows, row => row.sessionCount);
            const sessionRowsForClass = studentIds.flatMap(studentId => sessionsByStudent.get(studentId) || []);
            const sessionAttempts = sumBy(sessionRowsForClass, row => row.total);
            const sessionCorrectTotal = sumBy(sessionRowsForClass, row => row.correct);
            const avgSessionAccuracy = sessionAttempts > 0 ? Math.round((sessionCorrectTotal / sessionAttempts) * 100) : null;
            const wrongCount = studentIds.reduce((total, studentId) => total + (wrongByStudent.get(studentId) || []).length, 0);
            const coachCount = studentIds.reduce((total, studentId) => total + (coachByStudent.get(studentId) || []).length, 0);
            const activeStudentCount = studentRows.filter((row) => row.engagementScore > 0).length;
            const lastActivity = Math.max(
                toTs(classRow.created_at),
                ...roster.map(row => toTs(row.joined_at)),
                ...submissions.map(row => toTs(row.submitted_at || row.created_at)),
                ...sessionRowsForClass.map(row => toTs(row.ts || row.created_at)),
                0
            );
            const topStudents = studentRows.slice().sort((a, b) => {
                const aScore = Number.isFinite(a.avgAssignmentScore) ? a.avgAssignmentScore : -1;
                const bScore = Number.isFinite(b.avgAssignmentScore) ? b.avgAssignmentScore : -1;
                if (aScore === -1 && bScore === -1) {
                    if (b.engagementScore !== a.engagementScore) return b.engagementScore - a.engagementScore;
                } else if (bScore !== aScore) {
                    return bScore - aScore;
                }
                const aCompletion = Number.isFinite(a.completionRate) ? a.completionRate : -1;
                const bCompletion = Number.isFinite(b.completionRate) ? b.completionRate : -1;
                if (bCompletion !== aCompletion) return bCompletion - aCompletion;
                if (b.engagementScore !== a.engagementScore) return b.engagementScore - a.engagementScore;
                return a.name.localeCompare(b.name);
            }).slice(0, 3);
            const watchStudents = studentRows.slice().sort((a, b) => {
                const aScore = Number.isFinite(a.avgAssignmentScore) ? a.avgAssignmentScore : 101;
                const bScore = Number.isFinite(b.avgAssignmentScore) ? b.avgAssignmentScore : 101;
                if (aScore !== bScore) return aScore - bScore;
                const aCompletion = Number.isFinite(a.completionRate) ? a.completionRate : 101;
                const bCompletion = Number.isFinite(b.completionRate) ? b.completionRate : 101;
                if (aCompletion !== bCompletion) return aCompletion - bCompletion;
                if (a.engagementScore !== b.engagementScore) return a.engagementScore - b.engagementScore;
                return a.name.localeCompare(b.name);
            }).filter((row) => row.avgAssignmentScore === null || row.avgAssignmentScore < 70 || row.engagementScore === 0 || row.completionRate === 0)
                .filter((row) => !topStudents.some((top) => top.id === row.id))
                .slice(0, 3);

            return {
                id: classId,
                name: String(classRow.name || 'Unnamed Class'),
                code: String(classRow.code || ''),
                createdAt: classRow.created_at || '',
                studentCount,
                assignmentCount,
                submissionCount,
                completionRate,
                avgAssignmentScore,
                sessionCount,
                avgSessionAccuracy,
                wrongCount,
                coachCount,
                activeStudentCount,
                lastActivity,
                students: studentRows,
                topStudents,
                watchStudents
            };
        }).sort((a, b) => {
            const aScore = Number.isFinite(a.avgAssignmentScore) ? a.avgAssignmentScore : -1;
            const bScore = Number.isFinite(b.avgAssignmentScore) ? b.avgAssignmentScore : -1;
            if (bScore !== aScore) return bScore - aScore;
            if (b.studentCount !== a.studentCount) return b.studentCount - a.studentCount;
            return a.name.localeCompare(b.name);
        });

        const uniqueStudents = uniqueValues((rosterRows || []).map(row => String(row.student_id || '')));
        const totalSubmissions = sumBy(submissionRows, row => 1);
        const totalCorrect = sumBy(submissionRows, row => row.correct);
        const totalPossible = sumBy(submissionRows, row => row.total);
        const totalSessions = sumBy(sessionRows, row => 1);
        const totalSessionCorrect = sumBy(sessionRows, row => row.correct);
        const totalSessionAttempts = sumBy(sessionRows, row => row.total);
        const totalWrong = sumBy(wrongRows, row => 1);
        const totalCoach = sumBy(coachRows, row => 1);
        const totalClasses = classStats.length;
        const totalExpectedSubmissions = sumBy(classStats, row => row.studentCount * row.assignmentCount);
        const overallCompletion = totalExpectedSubmissions
            ? Math.round((totalSubmissions / totalExpectedSubmissions) * 100)
            : null;

        return {
            classes: classStats,
            selectedClassId: classStats[0]?.id || '',
            byClassId: new Map(classStats.map((row) => [row.id, row])),
            totals: {
                classCount: totalClasses,
                studentCount: uniqueStudents.length,
                avgAssignmentScore: totalPossible > 0 ? Math.round((totalCorrect / totalPossible) * 100) : null,
                completionRate: overallCompletion,
                sessionCount: totalSessions,
                avgSessionAccuracy: totalSessionAttempts > 0 ? Math.round((totalSessionCorrect / totalSessionAttempts) * 100) : null,
                wrongCount: totalWrong,
                coachCount: totalCoach
            }
        };
    }
    function renderTeacherAnalytics() {
        const classSelect = document.getElementById('analytics-class-select');
        const classList = document.getElementById('analytics-class-list');
        const titleEl = document.getElementById('analytics-class-title');
        const summaryEl = document.getElementById('analytics-class-summary');
        const summaryListEl = document.getElementById('analytics-class-summary-list');
        const topEl = document.getElementById('analytics-top-students');
        const watchEl = document.getElementById('analytics-watch-students');
        const selectedId = teacherAnalyticsState.selectedClassId || teacherAnalyticsState.classes[0]?.id || '';
        const selected = selectedId ? teacherAnalyticsState.byClassId.get(selectedId) : null;
        const classes = teacherAnalyticsState.classes || [];

        if (classSelect) {
            classSelect.innerHTML = classes.length
                ? classes.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} (${esc(item.code || 'no code')})</option>`).join('')
                : '<option value="">Create a class first</option>';
            classSelect.disabled = teacherAnalyticsState.loading || !classes.length;
            if (selected?.id) classSelect.value = selected.id;
        }

        if (!classes.length) {
            setMetric('teacher-analytics-students', 0);
            setMetric('teacher-analytics-score', '—');
            setMetric('teacher-analytics-completion', '—');
            setMetric('teacher-analytics-sessions', 0);
            if (titleEl) titleEl.textContent = teacherAnalyticsState.loading ? 'Loading class analytics...' : 'No classes yet';
            if (summaryEl) summaryEl.textContent = teacherAnalyticsState.loading
                ? 'Building a class-level snapshot from your rosters and submissions.'
                : 'Create a class to see average scores, completion, and engagement for the roster.';
            if (summaryListEl) summaryListEl.innerHTML = '';
            if (topEl) topEl.innerHTML = `<p class="muted">${esc(teacherAnalyticsState.loading ? 'Loading class analytics...' : 'No class analytics yet.')}</p>`;
            if (watchEl) watchEl.innerHTML = `<p class="muted">${esc(teacherAnalyticsState.loading ? 'Loading class analytics...' : 'No class analytics yet.')}</p>`;
            if (classList) classList.innerHTML = `<p class="muted">${esc(teacherAnalyticsState.loading ? 'Loading class analytics...' : 'Create a class to see the whole-class breakdown.')}</p>`;
            return;
        }

        if (!selected) {
            teacherAnalyticsState.selectedClassId = classes[0].id;
            return renderTeacherAnalytics();
        }

        const totals = teacherAnalyticsState.totals || {};
        setMetric('teacher-analytics-students', totals.studentCount || 0);
        setMetric('teacher-analytics-score', formatPct(totals.avgAssignmentScore));
        setMetric('teacher-analytics-completion', formatPct(totals.completionRate));
        setMetric('teacher-analytics-sessions', totals.sessionCount || 0);

        if (titleEl) titleEl.textContent = `${selected.name}${selected.code ? ` (${selected.code})` : ''}`;
        if (summaryEl) {
            const errorNote = teacherAnalyticsState.error ? ` Analytics refresh note: ${teacherAnalyticsState.error}` : '';
            const latest = selected.lastActivity ? ` Last activity ${new Date(selected.lastActivity).toLocaleString()}.` : '';
            const avgScore = Number.isFinite(selected.avgAssignmentScore) ? ` The class is averaging ${selected.avgAssignmentScore}% on submitted work.` : ' There are no scored submissions yet.';
            const completion = Number.isFinite(selected.completionRate) ? ` Submission completion is ${selected.completionRate}%.` : ' Submission completion is not available yet.';
            summaryEl.textContent = `${formatCount(selected.studentCount, 'student')} across ${formatCount(selected.assignmentCount, 'assignment')}.${avgScore}${completion}${latest}${errorNote}`;
        }
        if (summaryListEl) summaryListEl.innerHTML = buildClassSummaryList(selected);
        renderStudentList('analytics-top-students', selected.topStudents, 'No top students yet.');
        renderStudentList('analytics-watch-students', selected.watchStudents, 'No students need attention yet.');
        if (classList) {
            classList.innerHTML = classes.map((item) => {
                const active = item.id === selected.id;
                const score = Number.isFinite(item.avgAssignmentScore) ? `${item.avgAssignmentScore}%` : '—';
                const completion = Number.isFinite(item.completionRate) ? `${item.completionRate}% completion` : 'No completion yet';
                const meta = buildClassMetaLine(item);
                return `
                    <div class="list-item" style="${active ? 'border-color: rgba(96,165,250,0.55); background: rgba(96,165,250,0.08);' : ''}">
                        <div class="item-copy">
                            <span class="item-title">${esc(item.name)}</span>
                            <span class="item-meta">${esc(meta)} • ${esc(completion)}</span>
                        </div>
                        <span class="item-badge">${esc(item.code || 'No code')}</span>
                        <span class="item-score ${Number.isFinite(item.avgAssignmentScore) ? (item.avgAssignmentScore >= 80 ? 'good' : (item.avgAssignmentScore < 65 ? 'bad' : '')) : ''}">${esc(score)}</span>
                        <div class="item-actions">
                            <button class="btn ghost" type="button" data-analytics-class-id="${esc(item.id)}">View class</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
    async function loadTeacherAnalytics() {
        const version = ++teacherAnalyticsLoadVersion;
        teacherAnalyticsState.loading = true;
        teacherAnalyticsState.error = '';
        renderTeacherAnalytics();
        if (!myClasses.length) {
            teacherAnalyticsState.loading = false;
            teacherAnalyticsState.classes = [];
            teacherAnalyticsState.byClassId = new Map();
            teacherAnalyticsState.totals = null;
            renderTeacherAnalytics();
            return;
        }

        try {
            const classIds = myClasses.map((row) => String(row.id || '')).filter(Boolean);
            const [rosterRes, assignmentRes] = await Promise.all([
                classIds.length
                    ? sb.from('class_students').select('class_id, student_id, joined_at').in('class_id', classIds)
                    : Promise.resolve({ data: [] }),
                classIds.length
                    ? sb.from('assignments').select('id, class_id, title, created_at').in('class_id', classIds)
                    : Promise.resolve({ data: [] })
            ]);
            if (version !== teacherAnalyticsLoadVersion) return;
            const rosterRows = rosterRes.data || [];
            const assignmentRows = assignmentRes.data || [];
            const studentIds = uniqueValues(rosterRows.map((row) => String(row.student_id || '')));
            const assignmentIds = uniqueValues(assignmentRows.map((row) => String(row.id || '')));
            const [profileRes, submissionRes, sessionRes, wrongRes, coachRes] = await Promise.all([
                studentIds.length
                    ? sb.from('profiles').select('id, display_name, avatar_id').in('id', studentIds)
                    : Promise.resolve({ data: [] }),
                assignmentIds.length
                    ? sb.from('assignment_submissions').select('assignment_id, student_id, correct, total, submitted_at, created_at').in('assignment_id', assignmentIds)
                    : Promise.resolve({ data: [] }),
                studentIds.length
                    ? sb.from('user_drill_sessions').select('user_id, total, correct, dur, ts, created_at').in('user_id', studentIds).gte('created_at', STUDY_DATA_RESET_CUTOFF_ISO)
                    : Promise.resolve({ data: [] }),
                studentIds.length
                    ? sb.from('user_wrong_questions').select('user_id, created_at').in('user_id', studentIds).gte('created_at', STUDY_DATA_RESET_CUTOFF_ISO)
                    : Promise.resolve({ data: [] }),
                studentIds.length
                    ? sb.from('user_coach_attempts').select('user_id, created_at').in('user_id', studentIds).gte('created_at', STUDY_DATA_RESET_CUTOFF_ISO)
                    : Promise.resolve({ data: [] })
            ]);
            if (version !== teacherAnalyticsLoadVersion) return;
            const analytics = normalizeTeacherAnalyticsClassRows(
                myClasses,
                rosterRows,
                assignmentRows,
                submissionRes.data || [],
                sessionRes.data || [],
                wrongRes.data || [],
                coachRes.data || [],
                profileRes.data || []
            );
            if (version !== teacherAnalyticsLoadVersion) return;
            teacherAnalyticsState.loading = false;
            teacherAnalyticsState.error = '';
            teacherAnalyticsState.classes = analytics.classes;
            teacherAnalyticsState.byClassId = analytics.byClassId;
            teacherAnalyticsState.totals = analytics.totals;
            teacherAnalyticsState.selectedClassId = teacherAnalyticsState.selectedClassId && analytics.byClassId.has(teacherAnalyticsState.selectedClassId)
                ? teacherAnalyticsState.selectedClassId
                : analytics.selectedClassId;
            renderTeacherAnalytics();
            renderClasses();
        } catch (err) {
            if (version !== teacherAnalyticsLoadVersion) return;
            console.warn('[Teacher Analytics] unavailable', err);
            teacherAnalyticsState.loading = false;
            teacherAnalyticsState.error = err?.message || 'Class analytics could not be loaded.';
            teacherAnalyticsState.classes = myClasses.map((row) => ({
                id: String(row.id || ''),
                name: String(row.name || 'Unnamed Class'),
                code: String(row.code || ''),
                createdAt: row.created_at || '',
                studentCount: 0,
                assignmentCount: 0,
                submissionCount: 0,
                completionRate: null,
                avgAssignmentScore: null,
                sessionCount: 0,
                avgSessionAccuracy: null,
                wrongCount: 0,
                coachCount: 0,
                activeStudentCount: 0,
                lastActivity: 0,
                students: [],
                topStudents: [],
                watchStudents: []
            }));
            teacherAnalyticsState.byClassId = new Map(teacherAnalyticsState.classes.map((row) => [row.id, row]));
            teacherAnalyticsState.totals = {
                classCount: myClasses.length,
                studentCount: 0,
                avgAssignmentScore: null,
                completionRate: null,
                sessionCount: 0,
                avgSessionAccuracy: null,
                wrongCount: 0,
                coachCount: 0
            };
            teacherAnalyticsState.selectedClassId = teacherAnalyticsState.selectedClassId && teacherAnalyticsState.byClassId.has(teacherAnalyticsState.selectedClassId)
                ? teacherAnalyticsState.selectedClassId
                : teacherAnalyticsState.classes[0]?.id || '';
            renderTeacherAnalytics();
            renderClasses();
        }
    }

    // Load questions from questions.json
    try {
        const res = await fetch('questions.json');
        const json = await res.json();
        allQuestions = (Array.isArray(json) ? json : (json.items || json.questions || json.sets?.[0]?.items || []))
            .map(item => normalizeQuestionRecord(item))
            .filter(Boolean)
            .map(item => {
                item.meta.source = item.meta.source || 'original';
                return item;
            });
    } catch { console.warn('Could not load questions.json'); }
    try {
        const { data, error } = await sb
            .from(GENERATED_QUESTIONS_TABLE)
            .select('id, question_text, answer_text, aliases, category, era, source, topic, created_at')
            .eq('user_id', uid)
            .order('created_at', { ascending: false });
        if (error) throw error;
        const generated = (data || []).map(row => normalizeQuestionRecord({
            id: row.id,
            question_text: row.question_text,
            answer_text: row.answer_text,
            aliases: row.aliases,
            category: row.category,
            era: row.era,
            source: row.source,
            topic: row.topic
        })).filter(Boolean);
        allQuestions = dedupeQuestions([...generated, ...allQuestions]);
    } catch (err) {
        console.warn('[Teacher Generated Questions] unavailable', err);
    }
    populateGeneratorControls();

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
    function renderAccountAvatarPreview() {
        const resolvedAvatarId = normalizeAvatarId(selectedAvatarId);
        const previewImg = document.getElementById('acc-avatar-preview');
        const currentLabel = document.getElementById('acc-avatar-current-label');
        applyAvatarImage(previewImg, resolvedAvatarId, `${avatarLabel(resolvedAvatarId)} avatar`);
        if (currentLabel) currentLabel.textContent = avatarLabel(resolvedAvatarId);
    }
    function renderAccountAvatarPicker() {
        const picker = document.getElementById('acc-avatar-picker');
        if (!picker) return;
        picker.innerHTML = avatarOptions.map((option) => {
            const optionId = normalizeAvatarId(option.id);
            const isSelected = optionId === normalizeAvatarId(selectedAvatarId);
            return `
                <button
                    type="button"
                    class="avatar-option${isSelected ? ' selected' : ''}"
                    data-avatar-id="${esc(optionId)}"
                    role="radio"
                    aria-checked="${isSelected ? 'true' : 'false'}"
                >
                    <img class="avatar-option-image" data-avatar-id="${esc(optionId)}" alt="${esc(option.label)} avatar">
                    <span>${esc(option.label)}</span>
                    <small>${isSelected ? 'Selected' : 'Choose avatar'}</small>
                </button>
            `;
        }).join('');
        picker.querySelectorAll('.avatar-option-image').forEach((img) => {
            const optionId = normalizeAvatarId(img.dataset.avatarId);
            applyAvatarImage(img, optionId, `${avatarLabel(optionId)} avatar`);
        });
        picker.querySelectorAll('.avatar-option').forEach((button) => {
            button.addEventListener('click', () => {
                selectedAvatarId = normalizeAvatarId(button.dataset.avatarId);
                renderAccountAvatarPreview();
                renderAccountAvatarPicker();
            });
        });
    }
    function renderAccountProfile() {
        setInput('acc-display-name', profile.display_name || 'Unnamed');
        setInput('acc-role', formatRole(profile.role));
        setInput('acc-email', userEmail || '');
        setInput('acc-class-code', profile.class_code || '—');
        setInput('acc-created-at', profile.created_at ? new Date(profile.created_at).toLocaleString() : '—');
        setInput('acc-user-id', uid);
        selectedAvatarId = normalizeAvatarId(profile.avatar_id);
        renderAccountAvatarPreview();
        renderAccountAvatarPicker();
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
        const prevAvatarId = normalizeAvatarId(profile.avatar_id);
        const nextAvatarId = normalizeAvatarId(selectedAvatarId);
        const changeName = nextName !== prevName;
        const changeEmail = nextEmail !== prevEmail;
        const changeAvatar = nextAvatarId !== prevAvatarId;
        if (!changeName && !changeEmail && !changeAvatar) {
            showAlert('No profile changes to save.', 'success');
            return;
        }

        saveAccountBtn.disabled = true;
        const originalText = saveAccountBtn.textContent;
        saveAccountBtn.textContent = 'Saving...';

        try {
            const successMsgs = [];
            const errorMsgs = [];

            if (changeName || changeAvatar) {
                const profilePatch = {};
                if (changeName) profilePatch.display_name = nextName;
                if (changeAvatar) profilePatch.avatar_id = nextAvatarId;
                const { error } = await sb.from('profiles').update(profilePatch).eq('id', uid);
                if (error) {
                    if (changeName && changeAvatar) errorMsgs.push(`Profile update failed: ${error.message}`);
                    else if (changeName) errorMsgs.push(`Name update failed: ${error.message}`);
                    else errorMsgs.push(`Avatar update failed: ${error.message}`);
                } else {
                    if (changeName) {
                        profile.display_name = nextName;
                        successMsgs.push('Display name updated');
                    }
                    if (changeAvatar) {
                        profile.avatar_id = nextAvatarId;
                        successMsgs.push('Avatar updated');
                    }
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
        void loadTeacherAnalytics();
    }

    function renderClasses() {
        const el = document.getElementById('classes-list');
        setMetric('teacher-hero-classes', myClasses.length);
        if (!myClasses.length) {
            el.innerHTML = emptyStateHtml('Classes', 'No classes yet', 'Create your first class to generate an invite code and start assigning work.');
            return;
        }
        el.innerHTML = myClasses.map(c => `
            <div class="list-item">
                <div class="item-copy">
                    <span class="item-title">${esc(c.name)}</span>
                    <span class="item-meta">${esc(buildClassMetaLine(teacherAnalyticsState.byClassId.get(String(c.id || ''))))}</span>
                </div>
                <span class="item-badge">${c.code}</span>
                <div class="item-actions">
                    <button class="btn ghost" onclick="copyCode('${c.code}')">Copy Code</button>
                    <button class="btn ghost" onclick="viewStudents('${c.id}')">Students</button>
                    <button class="btn ghost" onclick="openClassAnalytics('${c.id}')">Analytics</button>
                    <button class="btn bad" onclick="deleteClass('${c.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    }

    window.copyCode = (code) => { navigator.clipboard.writeText(code).then(() => showAlert('Code copied: ' + code, 'success')); };

    // Modal helpers
    function showModal(title, bodyHtml) {
        document.getElementById('modal-title').textContent = title;
        const body = document.getElementById('modal-body');
        body.innerHTML = bodyHtml;
        hydrateAvatarImages(body);
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
        const { data: profiles } = await sb.from('profiles').select('id, display_name, avatar_id').in('id', ids);
        const profileMap = {};
        (profiles || []).forEach((p) => {
            profileMap[p.id] = {
                name: p.display_name || 'Unnamed',
                avatarId: normalizeAvatarId(p.avatar_id)
            };
        });
        const html = data.map(s => `
            <div class="list-item">
                ${userAvatarHtml(profileMap[s.student_id]?.avatarId, profileMap[s.student_id]?.name || 'Unnamed')}
                <div class="item-copy">
                    <span class="item-title">${esc(profileMap[s.student_id]?.name || 'Unnamed')}</span>
                    <span class="item-meta">Joined ${new Date(s.joined_at).toLocaleDateString()}</span>
                </div>
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

    document.getElementById('analytics-class-select')?.addEventListener('change', (event) => {
        selectAnalyticsClass(event.target.value);
    });
    document.getElementById('analytics-class-list')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-analytics-class-id]');
        if (!button) return;
        selectAnalyticsClass(button.dataset.analyticsClassId);
    });

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
        sel.innerHTML = myClasses.length
            ? myClasses.map(c => `<option value="${c.id}">${esc(c.name)} (${c.code})</option>`).join('')
            : '<option value="">Create a class first</option>';
    }

    // ========== ASSIGNMENTS ==========
    async function loadAssignments() {
        const { data } = await sb.from('assignments').select('*, classes(name, code)').eq('teacher_id', uid).order('created_at', { ascending: false });
        renderAssignments(data || []);
        void loadTeacherAnalytics();
    }

    function renderAssignments(list) {
        const el = document.getElementById('assignments-list');
        setMetric('teacher-hero-assignments', list.length);
        if (!list.length) {
            el.innerHTML = emptyStateHtml('Assignments', 'No assignments yet', 'Use the builder to create your first assignment and publish it to a class.');
            return;
        }
        el.innerHTML = list.map(a => {
            const due = a.due_date ? new Date(a.due_date).toLocaleDateString() : 'No due date';
            const cls = a.classes ? a.classes.name : '';
            return `<div class="list-item">
                <div class="item-copy">
                    <span class="item-title">${esc(a.title)}</span>
                    <span class="item-meta">${esc(cls)} · Due: ${due}</span>
                </div>
                <div class="item-actions">
                    <button class="btn ghost" onclick="viewScores('${a.id}')">View Scores</button>
                    <button class="btn bad" onclick="deleteAssignment('${a.id}')">Delete</button>
                </div>
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
        const { data: profiles } = await sb.from('profiles').select('id, display_name, avatar_id').in('id', allStudentIds);
        const profileMap = {};
        (profiles || []).forEach((p) => {
            profileMap[p.id] = {
                name: p.display_name || 'Unnamed',
                avatarId: normalizeAvatarId(p.avatar_id)
            };
        });

        if (!allStudentIds.length) { showModal('Submissions', '<p class="muted">No students in this class.</p>'); return; }

        const html = allStudentIds.map(sid => {
            const sub = subMap[sid];
            const student = profileMap[sid] || { name: 'Unnamed', avatarId: normalizeAvatarId('') };
            const avatar = userAvatarHtml(student.avatarId, student.name);
            if (sub) {
                const pct = sub.total ? Math.round(sub.correct / sub.total * 100) : 0;
                return `<div class="list-item">
                    ${avatar}
                    <div class="item-copy">
                        <span class="item-title">${esc(student.name)}</span>
                        <span class="item-meta">Submission recorded for this assignment.</span>
                    </div>
                    <span class="item-score ${pct >= 50 ? 'good' : 'bad'}">${sub.correct}/${sub.total} (${pct}%)</span>
                    <span class="status-pill done">✓ Completed</span>
                    <a class="btn ghost" href="profile.html?user=${encodeURIComponent(sid)}">Profile</a>
                </div>`;
            } else {
                return `<div class="list-item">
                    ${avatar}
                    <div class="item-copy">
                        <span class="item-title">${esc(student.name)}</span>
                        <span class="item-meta">No submission has been recorded yet.</span>
                    </div>
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
    renderGeneratedDraftPreview();

    async function persistGeneratedQuestions(items, { topic = '' } = {}) {
        if (!Array.isArray(items) || !items.length) return;
        const rows = items.map(item => ({
            id: String(item.id || questionKey(item)).trim(),
            user_id: uid,
            question_text: String(item.question || '').trim(),
            answer_text: String(item.answer || '').trim(),
            aliases: Array.isArray(item.aliases) ? item.aliases : [],
            category: String(item.meta?.category || '').trim(),
            era: String(item.meta?.era || '').trim(),
            source: String(item.meta?.source || 'generated').trim() || 'generated',
            topic: String(item.topic || topic || '').trim(),
            created_by_role: 'teacher',
            created_from: 'teacher-assignment'
        }));
        const { error } = await sb.from(GENERATED_QUESTIONS_TABLE).upsert(rows, { onConflict: 'id' });
        if (error) throw error;
    }

    async function requestGeneratedQuestions() {
        const region = String(document.getElementById('teacher-gen-region')?.value || '').trim()
            || (selectedFilterCategories.length === 1 ? selectedFilterCategories[0] : 'World');
        const era = String(document.getElementById('teacher-gen-era')?.value || '').trim()
            || (selectedFilterEras.length === 1 ? selectedFilterEras[0] : '');
        const topic = String(document.getElementById('teacher-gen-topic')?.value || '').trim();
        const count = Math.max(1, Math.min(12, Number.parseInt(String(document.getElementById('teacher-gen-count')?.value || '5'), 10) || 5));
        const avoidAnswers = allQuestions.map(q => String(q.answer || '').trim()).filter(Boolean).slice(0, 60);

        const response = await fetch('/api/generate-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                count,
                region,
                era,
                topic,
                creator_role: 'teacher',
                created_from: 'teacher-assignment',
                avoid_answers: avoidAnswers
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.error) {
            throw new Error(data?.error || `Question generation failed (${response.status})`);
        }
        return (data.items || []).map(item => normalizeQuestionRecord(item)).filter(Boolean);
    }

    document.getElementById('btn-teacher-generate')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-teacher-generate');
        if (!btn) return;
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = 'Generating...';
        updateGeneratorStatus('DeepSeek is drafting a fresh assignment set...', 'muted');
        try {
            const items = await requestGeneratedQuestions();
            if (!items.length) throw new Error('No valid generated questions came back.');
            generatedDraftQuestions = items.map(item => {
                item.meta.source = item.meta.source || 'generated';
                return item;
            });
            allQuestions = dedupeQuestions([...generatedDraftQuestions, ...allQuestions]);
            let persistenceNote = '';
            try {
                await persistGeneratedQuestions(generatedDraftQuestions, {
                    topic: String(document.getElementById('teacher-gen-topic')?.value || '').trim()
                });
            } catch (persistErr) {
                console.warn('[Teacher Generated Questions] persist failed', persistErr);
                persistenceNote = ' They were added to this draft only.';
            }
            populateGeneratorControls();
            renderGeneratedDraftPreview();
            updateGeneratorStatus(`Generated ${generatedDraftQuestions.length} draft question${generatedDraftQuestions.length === 1 ? '' : 's'}. Review them below, then add them into the assignment draft.${persistenceNote}`, 'muted');
        } catch (err) {
            generatedDraftQuestions = [];
            renderGeneratedDraftPreview();
            updateGeneratorStatus(err?.message || 'Question generation failed.', 'error');
            showAlert(err?.message || 'Question generation failed.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });

    document.getElementById('btn-teacher-add-draft')?.addEventListener('click', () => {
        if (!generatedDraftQuestions.length) {
            showAlert('Generate a draft first.', 'error');
            return;
        }
        setSelectedQuestions([...generatedDraftQuestions, ...selectedQuestions]);
        showAlert(`${generatedDraftQuestions.length} generated question${generatedDraftQuestions.length === 1 ? '' : 's'} added to the assignment draft.`, 'success');
    });

    function updatePreview() {
        const area = document.getElementById('preview-area');
        const count = document.getElementById('preview-count');
        const list = document.getElementById('preview-list');
        setMetric('teacher-hero-selected', selectedQuestions.length);
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
                aliases: Array.isArray(q.aliases) ? q.aliases : [],
                category: q.meta?.category || q.category || '',
                era: q.meta?.era || q.era || '',
                source: q.meta?.source || q.source || ''
            }));
            let { error: questionInsertError } = await sb.from('assignment_questions').insert(questions);
            if (questionInsertError && /aliases|source/i.test(String(questionInsertError.message || ''))) {
                const legacyRows = questions.map(({ aliases, source, ...rest }) => rest);
                const { error: legacyError } = await sb.from('assignment_questions').insert(legacyRows);
                questionInsertError = legacyError || null;
            }
            if (questionInsertError) throw questionInsertError;

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
