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

    // ========== WALKTHROUGH CHECK ==========
    const walkthruModal = document.getElementById('walkthrough-modal');
    const btnCloseWalkthru = document.getElementById('btn-close-walkthrough');
    const btnOpenWalkthru = document.getElementById('btn-walkthrough');
    const walkthroughKey = `ihbb_v2_walkthrough_seen_${uid}`;

    if (walkthruModal && btnCloseWalkthru && btnOpenWalkthru) {
        if (!localStorage.getItem(walkthroughKey)) {
            walkthruModal.classList.remove('hidden');
            localStorage.setItem(walkthroughKey, '1');
        }
        
        btnOpenWalkthru.addEventListener('click', (e) => {
            e.preventDefault();
            walkthruModal.classList.remove('hidden');
        });
        
        btnCloseWalkthru.addEventListener('click', () => {
            walkthruModal.classList.add('hidden');
        });
    }

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
    const TEACHER_BUILDER_MODES = new Set(['random', 'filter', 'pick']);
    const ACCOUNT_SETTING_DEFAULTS = Object.freeze({
        teacher_builder_default_class_id: '',
        teacher_builder_default_mode: 'random',
        teacher_builder_default_question_count: 10,
        teacher_analytics_default_class_id: ''
    });
    const normalizeTeacherClassId = (value) => String(value || '').trim();
    const normalizeTeacherBuilderMode = (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        return TEACHER_BUILDER_MODES.has(normalized) ? normalized : ACCOUNT_SETTING_DEFAULTS.teacher_builder_default_mode;
    };
    const normalizeTeacherQuestionCount = (value) => clampCount(value, ACCOUNT_SETTING_DEFAULTS.teacher_builder_default_question_count);
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
    const normalizeAccountSettings = (value) => {
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        return {
            ...source,
            teacher_builder_default_class_id: normalizeTeacherClassId(source.teacher_builder_default_class_id),
            teacher_builder_default_mode: normalizeTeacherBuilderMode(source.teacher_builder_default_mode),
            teacher_builder_default_question_count: normalizeTeacherQuestionCount(source.teacher_builder_default_question_count),
            teacher_analytics_default_class_id: normalizeTeacherClassId(source.teacher_analytics_default_class_id)
        };
    };
    let accountSettings = normalizeAccountSettings(profile.account_settings);
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
        studentsById: new Map(),
        totals: null
    };
    const teacherStudentDetailState = {
        studentId: '',
        selectedClassId: ''
    };
    const DAY_MS = 24 * 60 * 60 * 1000;
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
    const formatDuration = (seconds) => {
        const n = Number(seconds);
        if (!Number.isFinite(n) || n <= 0) return '—';
        if (n < 60) return `${Math.round(n)}s`;
        const mins = Math.floor(n / 60);
        const secs = Math.round(n % 60);
        return `${mins}m ${String(secs).padStart(2, '0')}s`;
    };
    const formatDate = (value) => {
        const ts = toTs(value);
        return ts ? new Date(ts).toLocaleDateString() : '—';
    };
    const formatDateTime = (value) => {
        const ts = toTs(value);
        return ts ? new Date(ts).toLocaleString() : '—';
    };
    const formatCount = (value, label) => `${value} ${label}${value === 1 ? '' : 's'}`;
    const sumBy = (list, getter) => (list || []).reduce((total, item) => total + toNum(getter(item), 0), 0);
    const averageBy = (list, getter) => {
        const rows = Array.isArray(list) ? list : [];
        if (!rows.length) return null;
        return sumBy(rows, getter) / rows.length;
    };
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
    const dedupeByKey = (list, getter) => {
        const map = new Map();
        (list || []).forEach((item) => {
            const key = getter(item);
            if (!key || map.has(key)) return;
            map.set(key, item);
        });
        return [...map.values()];
    };
    const pad2 = (n) => String(n).padStart(2, '0');
    const dayKeyFromDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const dayKeyFromTs = (value) => {
        const d = new Date(toTs(value));
        d.setHours(0, 0, 0, 0);
        return dayKeyFromDate(d);
    };
    const buildLast30Days = () => {
        const out = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 29; i >= 0; i--) {
            const day = new Date(today);
            day.setDate(day.getDate() - i);
            out.push({
                key: dayKeyFromDate(day),
                label: `${day.getMonth() + 1}/${day.getDate()}`,
                date: day,
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
    };
    const normalizeAnalyticsRegion = (value) => {
        const raw = String(value || '').trim();
        return raw || 'Unknown Region';
    };
    const normalizeAnalyticsEra = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return 'Unknown Era';
        const maybeCode = raw.length === 1 ? `0${raw}` : raw;
        return ERA_LABELS[maybeCode] || ERA_LABELS[raw] || raw;
    };
    const normalizeSessionForAnalytics = (raw) => {
        const ts = Number(raw?.ts) || (raw?.created_at ? new Date(raw.created_at).getTime() : 0);
        return {
            ts,
            total: toNum(raw?.total),
            correct: toNum(raw?.correct),
            dur: toNum(raw?.dur),
            buzz: Array.isArray(raw?.buzz) ? raw.buzz : [],
            items: Array.isArray(raw?.items) ? raw.items : [],
            results: Array.isArray(raw?.results) ? raw.results : [],
            meta: Array.isArray(raw?.meta) ? raw.meta : []
        };
    };
    const addDimStat = (mapObj, name, isCorrect, buzzValue) => {
        if (!mapObj[name]) mapObj[name] = { name, attempts: 0, correct: 0, buzzSum: 0, buzzN: 0 };
        mapObj[name].attempts += 1;
        if (isCorrect) mapObj[name].correct += 1;
        if (Number.isFinite(buzzValue) && buzzValue > 0) {
            mapObj[name].buzzSum += buzzValue;
            mapObj[name].buzzN += 1;
        }
    };
    const finalizeDimStats = (mapObj) => Object.values(mapObj).map((row) => ({
        name: row.name,
        attempts: row.attempts,
        correct: row.correct,
        accuracy: row.attempts ? Math.round((row.correct / row.attempts) * 100) : 0,
        avgBuzz: row.buzzN ? (row.buzzSum / row.buzzN) : null
    })).sort((a, b) => b.attempts - a.attempts || a.name.localeCompare(b.name));
    const summarizeWindow = (days) => {
        const attempts = sumBy(days, row => row.attempts);
        const correct = sumBy(days, row => row.correct);
        const buzzSum = sumBy(days, row => row.buzzSum);
        const buzzN = sumBy(days, row => row.buzzN);
        return {
            attempts,
            accuracy: attempts ? (correct / attempts * 100) : null,
            avgBuzz: buzzN ? (buzzSum / buzzN) : null
        };
    };
    const computeTeacherAnalyticsSnapshot = (sessionsRaw) => {
        const cutoff = Date.now() - (30 * DAY_MS);
        const sessions = (Array.isArray(sessionsRaw) ? sessionsRaw : [])
            .map(normalizeSessionForAnalytics)
            .filter((session) => Number(session.ts) >= cutoff)
            .sort((a, b) => Number(a.ts) - Number(b.ts));
        const days = buildLast30Days();
        const dayMap = new Map(days.map((day) => [day.key, day]));
        const eraAgg = {};
        const regionAgg = {};
        let totalAttempts = 0;
        let totalCorrect = 0;
        let totalBuzzSum = 0;
        let totalBuzzN = 0;
        let fastestBuzz = null;

        sessions.forEach((session) => {
            const day = dayMap.get(dayKeyFromTs(session.ts));
            totalAttempts += session.total;
            totalCorrect += session.correct;
            if (day) {
                day.sessions += 1;
                day.attempts += session.total;
                day.correct += session.correct;
            }

            (Array.isArray(session.buzz) ? session.buzz : []).forEach((buzzRaw) => {
                const buzz = Number(buzzRaw);
                if (!Number.isFinite(buzz) || buzz <= 0) return;
                totalBuzzSum += buzz;
                totalBuzzN += 1;
                if (day) {
                    day.buzzSum += buzz;
                    day.buzzN += 1;
                }
                if (fastestBuzz === null || buzz < fastestBuzz) fastestBuzz = buzz;
            });

            const ids = Array.isArray(session.items) ? session.items : [];
            const results = Array.isArray(session.results) ? session.results : [];
            if (!ids.length || !results.length) return;
            const maxLen = Math.min(ids.length, results.length);
            for (let i = 0; i < maxLen; i++) {
                const meta = Array.isArray(session.meta) ? session.meta[i] : null;
                const region = normalizeAnalyticsRegion(meta?.category || '');
                const era = normalizeAnalyticsEra(meta?.era || '');
                const isCorrect = !!results[i];
                const buzzValue = Number((Array.isArray(session.buzz) ? session.buzz : [])[i]);
                addDimStat(regionAgg, region, isCorrect, buzzValue);
                addDimStat(eraAgg, era, isCorrect, buzzValue);
            }
        });

        days.forEach((day) => {
            day.accuracy = day.attempts ? Math.round((day.correct / day.attempts) * 100) : null;
            day.avgBuzz = day.buzzN ? (day.buzzSum / day.buzzN) : null;
        });

        const eraStats = finalizeDimStats(eraAgg);
        const regionStats = finalizeDimStats(regionAgg);
        const blindSpots = [
            ...eraStats.map((row) => ({ ...row, dim: 'Era' })),
            ...regionStats.map((row) => ({ ...row, dim: 'Region' }))
        ]
            .filter((row) => row.attempts >= 4)
            .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts || a.name.localeCompare(b.name))
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
            activeDays: days.filter((day) => day.attempts > 0).length,
            accDelta7d: (last7.accuracy === null || prev7.accuracy === null) ? null : (last7.accuracy - prev7.accuracy),
            buzzDelta7d: (last7.avgBuzz === null || prev7.avgBuzz === null) ? null : (last7.avgBuzz - prev7.avgBuzz),
            eraStats,
            regionStats,
            blindSpots
        };
    };
    const renderStudentList = (containerId, rows, emptyCopy, options = {}) => {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (!rows || !rows.length) {
            el.innerHTML = `<p class="muted">${esc(emptyCopy)}</p>`;
            return;
        }
        const clickable = !!options.clickable;
        const classId = String(options.classId || '').trim();
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
            const actionHtml = clickable && row.id
                ? `<div class="item-actions"><span class="item-badge">Open analytics</span></div>`
                : '';
            const attrs = clickable && row.id
                ? `data-analytics-student-id="${esc(row.id)}" data-analytics-student-class-id="${esc(classId)}" tabindex="0" role="button"`
                : '';
            return `
                <div class="list-item ${clickable && row.id ? 'analytics-student-row' : ''}" ${attrs}>
                    ${userAvatarHtml(row.avatarId || '', row.name || 'Unnamed')}
                    <div class="item-copy">
                        <span class="item-title">${esc(row.name || 'Unnamed')}</span>
                        <span class="item-meta">${esc(detailBits.join(' • '))}</span>
                    </div>
                    <span class="item-score ${scoreClass}">${esc(score)}</span>
                    ${actionHtml}
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
        const rosterByStudent = groupBy(rosterRows, row => String(row.student_id || ''));
        const assignmentsByClass = groupBy(assignmentRows, row => String(row.class_id || ''));
        const assignmentById = new Map((assignmentRows || []).map((row) => [String(row.id || ''), row]));
        const submissionsByAssignment = groupBy(submissionRows, row => String(row.assignment_id || ''));
        const submissionsByStudent = groupBy(submissionRows, row => String(row.student_id || ''));
        const sessionsByStudent = groupBy(sessionRows, row => String(row.user_id || ''));
        const wrongByStudent = groupBy(wrongRows, row => String(row.user_id || ''));
        const coachByStudent = groupBy(coachRows, row => String(row.user_id || ''));
        const profileById = new Map((profileRows || []).map((row) => [String(row.id || ''), row]));
        const classRowById = new Map((classRows || []).map((row) => [String(row.id || ''), row]));

        const classStats = (classRows || []).map((classRow) => {
            const classId = String(classRow.id || '');
            const roster = rosterByClass.get(classId) || [];
            const assignmentList = assignmentsByClass.get(classId) || [];
            const submissions = assignmentList.length
                ? assignmentList.flatMap((assignment) => submissionsByAssignment.get(String(assignment.id || '')) || [])
                : [];
            const submissionsForClassByStudent = groupBy(submissions, row => String(row.student_id || ''));
            const studentIds = uniqueValues(roster.map((row) => String(row.student_id || '')).filter(Boolean));
            const assignmentCount = assignmentList.length;
            const studentRows = studentIds.map((studentId) => {
                const profile = profileById.get(studentId) || {};
                const studentSubmissions = submissionsForClassByStudent.get(studentId) || [];
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

        const classStatsById = new Map(classStats.map((row) => [row.id, row]));
        const uniqueStudents = uniqueValues((rosterRows || []).map(row => String(row.student_id || '')));
        const studentDetails = uniqueStudents.map((studentId) => {
            const profile = profileById.get(studentId) || {};
            const studentSessions = sessionsByStudent.get(studentId) || [];
            const studentWrong = wrongByStudent.get(studentId) || [];
            const studentCoach = coachByStudent.get(studentId) || [];
            const membershipRows = rosterByStudent.get(studentId) || [];
            const studentSubmissionRows = submissionsByStudent.get(studentId) || [];

            const classes = membershipRows.map((membershipRow) => {
                const classId = String(membershipRow.class_id || '');
                const classInfo = classRowById.get(classId) || {};
                const classSummary = classStatsById.get(classId) || {};
                const assignmentList = assignmentsByClass.get(classId) || [];
                const latestSubmissionByAssignment = new Map();
                studentSubmissionRows.forEach((submission) => {
                    const assignmentId = String(submission.assignment_id || '');
                    if (!assignmentId) return;
                    const assignment = assignmentById.get(assignmentId);
                    if (String(assignment?.class_id || '') !== classId) return;
                    const existing = latestSubmissionByAssignment.get(assignmentId);
                    const existingTs = toTs(existing?.submitted_at || existing?.created_at);
                    const nextTs = toTs(submission.submitted_at || submission.created_at);
                    if (!existing || nextTs >= existingTs) latestSubmissionByAssignment.set(assignmentId, submission);
                });

                const assignmentItems = assignmentList.map((assignment) => {
                    const assignmentId = String(assignment.id || '');
                    const submission = latestSubmissionByAssignment.get(assignmentId) || null;
                    const submissionTotal = toNum(submission?.total);
                    const score = submission && submissionTotal > 0
                        ? Math.round((toNum(submission?.correct) / submissionTotal) * 100)
                        : null;
                    return {
                        assignmentId,
                        classId,
                        className: String(classInfo.name || classSummary.name || 'Unnamed Class'),
                        classCode: String(classInfo.code || classSummary.code || ''),
                        title: String(assignment.title || 'Untitled assignment'),
                        dueDate: assignment.due_date || '',
                        createdAt: assignment.created_at || '',
                        submission: submission ? {
                            correct: toNum(submission.correct),
                            total: submissionTotal,
                            submittedAt: submission.submitted_at || submission.created_at || '',
                            score
                        } : null
                    };
                }).sort((a, b) => {
                    const aPending = !a.submission;
                    const bPending = !b.submission;
                    if (aPending !== bPending) return aPending ? -1 : 1;
                    const aTs = toTs(a.submission?.submittedAt || a.dueDate || a.createdAt);
                    const bTs = toTs(b.submission?.submittedAt || b.dueDate || b.createdAt);
                    return bTs - aTs || a.title.localeCompare(b.title);
                });

                const submittedItems = assignmentItems.filter((item) => item.submission);
                const assignmentCorrect = sumBy(submittedItems, item => item.submission.correct);
                const assignmentTotal = sumBy(submittedItems, item => item.submission.total);
                const joinedAt = membershipRow.joined_at || '';
                const lastActivity = Math.max(
                    toTs(joinedAt),
                    ...assignmentItems.map((item) => toTs(item.submission?.submittedAt || item.dueDate || item.createdAt)),
                    toTs(classSummary.lastActivity || 0),
                    0
                );

                return {
                    classId,
                    className: String(classInfo.name || classSummary.name || 'Unnamed Class'),
                    classCode: String(classInfo.code || classSummary.code || ''),
                    joinedAt,
                    assignmentCount: assignmentItems.length,
                    submissionCount: submittedItems.length,
                    completionRate: assignmentItems.length ? Math.round((submittedItems.length / assignmentItems.length) * 100) : null,
                    avgAssignmentScore: assignmentTotal > 0 ? Math.round((assignmentCorrect / assignmentTotal) * 100) : null,
                    lastActivity,
                    assignmentItems
                };
            }).sort((a, b) => a.className.localeCompare(b.className));

            const assignmentItems = dedupeByKey(classes.flatMap((classInfo) => classInfo.assignmentItems), (item) => item.assignmentId);
            const submittedAssignments = assignmentItems.filter((item) => item.submission);
            const assignmentCorrect = sumBy(submittedAssignments, item => item.submission.correct);
            const assignmentTotal = sumBy(submittedAssignments, item => item.submission.total);
            const sessionCorrect = sumBy(studentSessions, row => row.correct);
            const sessionTotal = sumBy(studentSessions, row => row.total);
            const totalAnswers = assignmentTotal + sessionTotal;
            const latestActivity = Math.max(
                ...classes.map((classInfo) => toTs(classInfo.lastActivity)),
                ...studentSessions.map((row) => toTs(row.ts || row.created_at)),
                ...studentWrong.map((row) => toTs(row.created_at)),
                ...studentCoach.map((row) => toTs(row.created_at)),
                0
            );

            return {
                id: studentId,
                name: String(profile.display_name || 'Unnamed'),
                avatarId: normalizeAvatarId(profile.avatar_id),
                classes,
                assignmentItems,
                sessions: studentSessions,
                wrongRows: studentWrong,
                coachRows: studentCoach,
                snapshot: computeTeacherAnalyticsSnapshot(studentSessions),
                summary: {
                    overallAccuracy: totalAnswers > 0 ? Math.round(((assignmentCorrect + sessionCorrect) / totalAnswers) * 100) : null,
                    totalAnswers,
                    sessionAnswers: sessionTotal,
                    assignmentAnswers: assignmentTotal,
                    practiceSessions: studentSessions.length,
                    sessionAccuracy: sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : null,
                    avgSessionDuration: averageBy(studentSessions, row => row.dur),
                    assignmentCount: assignmentItems.length,
                    assignmentSubmissions: submittedAssignments.length,
                    assignmentAccuracy: assignmentTotal > 0 ? Math.round((assignmentCorrect / assignmentTotal) * 100) : null,
                    overallCompletion: assignmentItems.length ? Math.round((submittedAssignments.length / assignmentItems.length) * 100) : null,
                    wrongBankRows: studentWrong.length,
                    coachAttempts: studentCoach.length,
                    classMemberships: classes.length,
                    latestActivity: latestActivity || null
                }
            };
        });

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
            studentsById: new Map(studentDetails.map((row) => [row.id, row])),
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
    const getTeacherStudentContext = (detail, selectedClassId) => {
        const requestedClassId = String(selectedClassId || '').trim();
        const selectedClass = requestedClassId
            ? (detail?.classes || []).find((row) => row.classId === requestedClassId) || null
            : null;
        const assignmentItems = selectedClass ? selectedClass.assignmentItems : (detail?.assignmentItems || []);
        const submittedItems = assignmentItems.filter((item) => item?.submission);
        const assignmentCorrect = sumBy(submittedItems, item => item.submission.correct);
        const assignmentTotal = sumBy(submittedItems, item => item.submission.total);
        const sessionCorrect = sumBy(detail?.sessions || [], row => row.correct);
        const sessionTotal = sumBy(detail?.sessions || [], row => row.total);
        const totalAnswers = assignmentTotal + sessionTotal;
        const latestActivity = Math.max(
            toTs(detail?.summary?.latestActivity),
            ...assignmentItems.map((item) => toTs(item?.submission?.submittedAt || item?.dueDate || item?.createdAt)),
            0
        );
        return {
            selectedClass,
            selectedClassId: selectedClass?.classId || '',
            classLabel: selectedClass
                ? `${selectedClass.className}${selectedClass.classCode ? ` (${selectedClass.classCode})` : ''}`
                : 'All visible classes',
            assignmentItems,
            submittedItems,
            assignmentAccuracy: assignmentTotal > 0 ? Math.round((assignmentCorrect / assignmentTotal) * 100) : null,
            completionRate: assignmentItems.length ? Math.round((submittedItems.length / assignmentItems.length) * 100) : null,
            overallAccuracy: totalAnswers > 0 ? Math.round(((assignmentCorrect + sessionCorrect) / totalAnswers) * 100) : null,
            latestActivity: latestActivity || null,
            pendingCount: assignmentItems.filter((item) => !item?.submission).length
        };
    };
    const buildTeacherStudentPerformanceListHtml = (stats, emptyCopy) => {
        if (!Array.isArray(stats) || !stats.length) return `<p class="muted">${esc(emptyCopy)}</p>`;
        return `
            <div class="analytics-perf-list">
                ${stats.slice(0, 6).map((row) => `
                    <div class="analytics-perf-row">
                        <div class="analytics-perf-top">
                            <div class="analytics-perf-name">${esc(row.name || 'Unknown')}</div>
                            <div class="analytics-perf-meta">${esc(`${row.attempts || 0} q`)}</div>
                        </div>
                        <div class="analytics-perf-bar">
                            <span class="analytics-perf-fill" style="width:${Math.max(4, Number(row.accuracy || 0))}%; --perf-color:${Number(row.accuracy || 0) >= 75 ? '#34d399' : (Number(row.accuracy || 0) >= 60 ? '#fbbf24' : '#f87171')};"></span>
                        </div>
                        <div class="analytics-perf-bottom">
                            <span>${esc(Number.isFinite(row.avgBuzz) ? `${row.avgBuzz.toFixed(2)}s avg buzz` : 'No buzz timing saved')}</span>
                            <strong>${esc(formatPct(row.accuracy))}</strong>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    };
    const buildTeacherStudentBlindSpotsHtml = (spots) => {
        if (!Array.isArray(spots) || !spots.length) return '<p class="muted">No blind spots detected from the recent drill data.</p>';
        return `
            <div class="analytics-blind-list">
                ${spots.slice(0, 6).map((spot) => {
                    const severity = Number(spot.accuracy) < 50 ? 'High priority' : (Number(spot.accuracy) < 70 ? 'Watch' : 'Emerging');
                    return `
                        <div class="analytics-blind-card">
                            <div class="analytics-blind-head">
                                <div class="analytics-blind-name">${esc(spot.name || 'Unknown')}</div>
                                <div class="analytics-blind-tag">${esc(severity)}</div>
                            </div>
                            <div class="analytics-perf-bottom">
                                <span>${esc(`${spot.dim || 'Focus'} • ${spot.attempts || 0} questions`)}</span>
                                <strong>${esc(formatPct(spot.accuracy))}</strong>
                            </div>
                            <div class="analytics-perf-bottom">
                                <span>${esc(Number.isFinite(spot.avgBuzz) ? `${spot.avgBuzz.toFixed(2)}s avg buzz` : 'No buzz timing saved')}</span>
                                <strong>${esc(`${spot.correct || 0}/${spot.attempts || 0} correct`)}</strong>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    };
    const buildTeacherStudentHeatmapHtml = (snapshot) => {
        const days = Array.isArray(snapshot?.days) ? snapshot.days : [];
        if (!days.length || !snapshot?.totalAttempts) {
            return `
                <div class="analytics-heatmap">
                    ${Array.from({ length: 30 }).map(() => '<div class="analytics-heat-cell analytics-heat-0"></div>').join('')}
                </div>
                <div class="muted" style="margin-top:10px;">No 30-day drill activity yet.</div>
            `;
        }
        const maxAttempts = Math.max(...days.map((day) => Number(day.attempts || 0)), 0);
        const cells = days.map((day) => {
            const attempts = Number(day.attempts || 0);
            const ratio = maxAttempts > 0 ? (attempts / maxAttempts) : 0;
            const intensity = attempts <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(ratio * 4)));
            const title = `${day.label}: ${attempts} questions${day.accuracy === null ? '' : ` • ${day.accuracy}% accuracy`}`;
            return `<div class="analytics-heat-cell analytics-heat-${intensity}" title="${esc(title)}"></div>`;
        }).join('');
        const caption = `${snapshot.activeDays || 0} active days in the last 30. Fastest buzz: ${Number.isFinite(snapshot.fastestBuzz) ? `${snapshot.fastestBuzz.toFixed(2)}s` : '—'}.`;
        return `
            <div class="analytics-heatmap">${cells}</div>
            <div class="muted" style="margin-top:10px;">${esc(caption)}</div>
        `;
    };
    const buildTeacherStudentAssignmentsHtml = (context) => {
        if (!Array.isArray(context?.assignmentItems) || !context.assignmentItems.length) {
            return '<p class="muted">No assignments are attached to this class context yet.</p>';
        }
        return context.assignmentItems.map((item) => {
            const submission = item.submission;
            const score = Number.isFinite(submission?.score) ? `${submission.score}%` : '—';
            const scoreClass = Number.isFinite(submission?.score)
                ? (submission.score >= 80 ? 'good' : (submission.score < 65 ? 'bad' : ''))
                : '';
            const meta = [
                item.className ? item.className : '',
                item.dueDate ? `Due ${formatDate(item.dueDate)}` : '',
                submission?.submittedAt ? `Submitted ${formatDateTime(submission.submittedAt)}` : 'No submission yet'
            ].filter(Boolean);
            return `
                <div class="list-item">
                    <div class="item-copy">
                        <span class="item-title">${esc(item.title || 'Untitled assignment')}</span>
                        <span class="item-meta">${esc(meta.join(' • '))}</span>
                    </div>
                    ${submission
                        ? `<span class="status-pill done">Completed</span><span class="item-score ${scoreClass}">${esc(`${submission.correct}/${submission.total} • ${score}`)}</span>`
                        : `<span class="status-pill pending">Pending</span>`}
                </div>
            `;
        }).join('');
    };
    const buildTeacherStudentRecentActivityHtml = (detail, context) => {
        const events = [];
        (context?.submittedItems || []).forEach((item) => {
            const submittedAt = item?.submission?.submittedAt || '';
            events.push({
                ts: toTs(submittedAt),
                title: item.title || 'Assignment submission',
                type: 'Assignment',
                detail: `${item.className || 'Class'} • ${item.submission.correct}/${item.submission.total} • ${Number.isFinite(item.submission.score) ? `${item.submission.score}%` : '—'}`
            });
        });
        (detail?.sessions || []).forEach((session) => {
            const total = toNum(session.total);
            const correct = toNum(session.correct);
            const accuracy = total > 0 ? Math.round((correct / total) * 100) : null;
            events.push({
                ts: toTs(session.ts || session.created_at),
                title: `${formatCount(total, 'question')} in practice`,
                type: 'Drill session',
                detail: `${accuracy === null ? '—' : `${accuracy}% accuracy`} • ${formatDuration(session.dur)}`
            });
        });
        (detail?.wrongRows || []).forEach((row) => {
            events.push({
                ts: toTs(row.created_at),
                title: 'Added a question to the wrong-bank queue',
                type: 'Wrong-bank',
                detail: 'Saved for later review'
            });
        });
        (detail?.coachRows || []).forEach((row) => {
            events.push({
                ts: toTs(row.created_at),
                title: 'Saved a coach notebook attempt',
                type: 'Coach',
                detail: 'Stored for follow-up review'
            });
        });
        const ranked = events
            .filter((event) => event.ts > 0)
            .sort((a, b) => b.ts - a.ts)
            .slice(0, 8);
        if (!ranked.length) return '<p class="muted">No recent activity has been saved for this student yet.</p>';
        return ranked.map((event) => `
            <div class="summary-item">
                <span>${esc(event.type)}</span>
                <strong>${esc(event.title)}</strong>
                <div class="muted">${esc(`${event.detail} • ${formatDateTime(event.ts)}`)}</div>
            </div>
        `).join('');
    };
    const buildTeacherStudentClassListHtml = (detail, selectedClassId) => {
        const activeClassId = String(selectedClassId || '').trim();
        const allMeta = `${formatCount(detail?.classes?.length || 0, 'class')} visible to this teacher`;
        const rows = [
            `
                <div class="list-item analytics-class-context-row ${activeClassId ? '' : 'is-active'}" data-student-detail-class-id="" tabindex="0" role="button">
                    <div class="item-copy">
                        <span class="item-title">All visible classes</span>
                        <span class="item-meta">${esc(allMeta)} • Combine assignment context across every class this teacher manages.</span>
                    </div>
                    <div class="item-actions">
                        <span class="item-badge">${activeClassId ? 'Switch' : 'Selected'}</span>
                    </div>
                </div>
            `
        ];
        (detail?.classes || []).forEach((classInfo) => {
            const meta = [
                classInfo.assignmentCount ? formatCount(classInfo.assignmentCount, 'assignment') : 'No assignments yet',
                classInfo.submissionCount ? formatCount(classInfo.submissionCount, 'submission') : 'No submissions yet',
                Number.isFinite(classInfo.completionRate) ? `${classInfo.completionRate}% completion` : 'No completion yet',
                classInfo.joinedAt ? `Joined ${formatDate(classInfo.joinedAt)}` : ''
            ].filter(Boolean);
            rows.push(`
                <div class="list-item analytics-class-context-row ${activeClassId === classInfo.classId ? 'is-active' : ''}" data-student-detail-class-id="${esc(classInfo.classId)}" tabindex="0" role="button">
                    <div class="item-copy">
                        <span class="item-title">${esc(classInfo.className)}</span>
                        <span class="item-meta">${esc(meta.join(' • '))}</span>
                    </div>
                    <span class="item-badge">${esc(classInfo.classCode || 'No code')}</span>
                    <div class="item-actions">
                        <span class="item-badge">${activeClassId === classInfo.classId ? 'Selected' : 'Switch'}</span>
                    </div>
                </div>
            `);
        });
        return rows.join('');
    };
    function renderTeacherStudentAnalyticsModal() {
        const detail = teacherAnalyticsState.studentsById.get(teacherStudentDetailState.studentId);
        if (!detail) {
            showModal('Student analytics', '<p class="muted">Student analytics are not available yet.</p>');
            return;
        }
        const selectedClassId = teacherStudentDetailState.selectedClassId && detail.classes.some((row) => row.classId === teacherStudentDetailState.selectedClassId)
            ? teacherStudentDetailState.selectedClassId
            : '';
        teacherStudentDetailState.selectedClassId = selectedClassId;
        const context = getTeacherStudentContext(detail, selectedClassId);
        const snapshot = detail.snapshot || computeTeacherAnalyticsSnapshot([]);
        const classOptions = [
            '<option value="">All visible classes</option>',
            ...detail.classes.map((classInfo) => `<option value="${esc(classInfo.classId)}">${esc(classInfo.className)}${classInfo.classCode ? ` (${esc(classInfo.classCode)})` : ''}</option>`)
        ].join('');
        const heroTitle = context.overallAccuracy === null
            ? 'No graded history yet'
            : (context.overallAccuracy >= 80 ? 'Strong overall signal' : (context.overallAccuracy >= 65 ? 'Mixed but workable' : 'Clear follow-up needed'));
        const summaryCopy = context.assignmentItems.length
            ? `${context.submittedItems.length}/${context.assignmentItems.length} assignments completed in ${context.classLabel}. Drill, wrong-bank, and coach activity remain student-wide because practice sessions are not tied to a class.`
            : `No assignments are attached to ${context.classLabel} yet. Drill, wrong-bank, and coach activity remain student-wide because practice sessions are not tied to a class.`;
        const bodyHtml = `
            <div class="teacher-student-analytics-shell">
                <div class="card-muted-box teacher-student-analytics-toolbar">
                    ${userAvatarHtml(detail.avatarId || '', detail.name || 'Unnamed')}
                    <div class="item-copy">
                        <div class="eyebrow">Student detail</div>
                        <span class="item-title">${esc(detail.name || 'Unnamed')}</span>
                        <span class="item-meta">${esc(`${detail.summary.classMemberships || 0} class memberships • Latest activity ${formatDateTime(context.latestActivity || detail.summary.latestActivity)}`)}</span>
                    </div>
                    <div class="input-group teacher-student-class-switch">
                        <label for="student-analytics-class-select">Class context</label>
                        <select id="student-analytics-class-select">${classOptions}</select>
                    </div>
                    <div class="item-actions">
                        <a class="btn ghost" href="profile.html?user=${encodeURIComponent(detail.id)}">Open Profile</a>
                    </div>
                </div>

                <div class="analytics-hero">
                    <div class="analytics-hero-copy">
                        <div class="eyebrow">${esc(context.classLabel)}</div>
                        <h3>${esc(heroTitle)}</h3>
                        <p class="analytics-hero-summary">${esc(summaryCopy)}</p>
                    </div>
                    <div class="analytics-hero-meta">
                        <div class="analytics-hero-chip">
                            <span>Latest activity</span>
                            <strong>${esc(formatDateTime(context.latestActivity || detail.summary.latestActivity))}</strong>
                        </div>
                        <div class="analytics-hero-chip">
                            <span>30-day active days</span>
                            <strong>${esc(`${snapshot.activeDays || 0} / 30`)}</strong>
                        </div>
                        <div class="analytics-hero-chip">
                            <span>Fastest buzz</span>
                            <strong>${esc(Number.isFinite(snapshot.fastestBuzz) ? `${snapshot.fastestBuzz.toFixed(2)}s` : '—')}</strong>
                        </div>
                    </div>
                </div>

                <div class="analytics-kpis">
                    <div class="analytics-kpi">
                        <div class="analytics-kpi-label">Overall Accuracy</div>
                        <div class="analytics-kpi-value">${esc(formatPct(context.overallAccuracy))}</div>
                    </div>
                    <div class="analytics-kpi">
                        <div class="analytics-kpi-label">Assignment Average</div>
                        <div class="analytics-kpi-value">${esc(formatPct(context.assignmentAccuracy))}</div>
                    </div>
                    <div class="analytics-kpi">
                        <div class="analytics-kpi-label">Class Completion</div>
                        <div class="analytics-kpi-value">${esc(formatPct(context.completionRate))}</div>
                    </div>
                    <div class="analytics-kpi">
                        <div class="analytics-kpi-label">30-Day Questions</div>
                        <div class="analytics-kpi-value">${esc((snapshot.totalAttempts || 0).toLocaleString())}</div>
                    </div>
                    <div class="analytics-kpi">
                        <div class="analytics-kpi-label">Wrong-Bank Rows</div>
                        <div class="analytics-kpi-value">${esc(String(detail.summary.wrongBankRows || 0))}</div>
                    </div>
                    <div class="analytics-kpi">
                        <div class="analytics-kpi-label">Coach Attempts</div>
                        <div class="analytics-kpi-value">${esc(String(detail.summary.coachAttempts || 0))}</div>
                    </div>
                </div>

                <div class="summary-list teacher-student-summary-grid">
                    <div class="summary-item">
                        <span>Practice</span>
                        <strong>${esc(`${detail.summary.practiceSessions || 0} total sessions • ${formatPct(detail.summary.sessionAccuracy)} accuracy`)}</strong>
                    </div>
                    <div class="summary-item">
                        <span>Session Length</span>
                        <strong>${esc(formatDuration(detail.summary.avgSessionDuration))}</strong>
                    </div>
                    <div class="summary-item">
                        <span>Assignment Volume</span>
                        <strong>${esc(`${context.submittedItems.length}/${context.assignmentItems.length || 0} completed • ${context.pendingCount} pending`)}</strong>
                    </div>
                    <div class="summary-item">
                        <span>Visible Classes</span>
                        <strong>${esc(formatCount(detail.summary.classMemberships || 0, 'class'))}</strong>
                    </div>
                </div>

                <div class="analytics-split-grid teacher-student-detail-grid">
                    <div class="analytics-panel">
                        <div class="analytics-panel-head">
                            <div>
                                <div class="analytics-panel-kicker">Assignments</div>
                                <h3>Class work</h3>
                                <p class="analytics-panel-note">Every assignment in the selected class context, including incomplete work.</p>
                            </div>
                        </div>
                        <div class="list-container teacher-analytics-list">${buildTeacherStudentAssignmentsHtml(context)}</div>
                    </div>
                    <div class="analytics-panel">
                        <div class="analytics-panel-head">
                            <div>
                                <div class="analytics-panel-kicker">Class context</div>
                                <h3>Switch classes</h3>
                                <p class="analytics-panel-note">Change the assignment context without leaving the teacher analytics view.</p>
                            </div>
                        </div>
                        <div class="list-container teacher-analytics-list">${buildTeacherStudentClassListHtml(detail, context.selectedClassId)}</div>
                    </div>
                </div>

                <div class="analytics-split-grid teacher-student-detail-grid">
                    <div class="analytics-panel">
                        <div class="analytics-panel-head">
                            <div>
                                <div class="analytics-panel-kicker">Breakdown</div>
                                <h3>Era performance</h3>
                                <p class="analytics-panel-note">30-day drill accuracy by era.</p>
                            </div>
                        </div>
                        ${buildTeacherStudentPerformanceListHtml(snapshot.eraStats, 'No era-tagged drill data yet.')}
                    </div>
                    <div class="analytics-panel">
                        <div class="analytics-panel-head">
                            <div>
                                <div class="analytics-panel-kicker">Breakdown</div>
                                <h3>Region performance</h3>
                                <p class="analytics-panel-note">30-day drill accuracy by region.</p>
                            </div>
                        </div>
                        ${buildTeacherStudentPerformanceListHtml(snapshot.regionStats, 'No region-tagged drill data yet.')}
                    </div>
                </div>

                <div class="analytics-split-grid teacher-student-detail-grid">
                    <div class="analytics-panel">
                        <div class="analytics-panel-head">
                            <div>
                                <div class="analytics-panel-kicker">Diagnosis</div>
                                <h3>Blind spot radar</h3>
                                <p class="analytics-panel-note">Low-accuracy clusters from the most recent 30-day drill history.</p>
                            </div>
                        </div>
                        ${buildTeacherStudentBlindSpotsHtml(snapshot.blindSpots)}
                    </div>
                    <div class="analytics-panel">
                        <div class="analytics-panel-head">
                            <div>
                                <div class="analytics-panel-kicker">Cadence</div>
                                <h3>Consistency heatmap</h3>
                                <p class="analytics-panel-note">Read this as a rhythm map for the last 30 days of drill activity.</p>
                            </div>
                        </div>
                        ${buildTeacherStudentHeatmapHtml(snapshot)}
                    </div>
                </div>

                <div class="analytics-panel">
                    <div class="analytics-panel-head">
                        <div>
                            <div class="analytics-panel-kicker">Recent activity</div>
                            <h3>Latest saved events</h3>
                            <p class="analytics-panel-note">Assignments respect the class filter. Practice, wrong-bank, and coach events stay student-wide.</p>
                        </div>
                    </div>
                    <div class="summary-list teacher-student-activity-list">${buildTeacherStudentRecentActivityHtml(detail, context)}</div>
                </div>
            </div>
        `;
        showModal(`${detail.name} Analytics`, bodyHtml, {
            wide: true,
            bodyClass: 'teacher-student-analytics-body'
        });
        const select = document.getElementById('student-analytics-class-select');
        if (select) select.value = context.selectedClassId;
    }
    function openTeacherStudentAnalytics(studentId, preferredClassId = '') {
        const nextStudentId = String(studentId || '').trim();
        if (!nextStudentId || !teacherAnalyticsState.studentsById.has(nextStudentId)) return;
        const detail = teacherAnalyticsState.studentsById.get(nextStudentId);
        const requestedClassId = String(preferredClassId || '').trim();
        teacherStudentDetailState.studentId = nextStudentId;
        teacherStudentDetailState.selectedClassId = requestedClassId && detail?.classes?.some((row) => row.classId === requestedClassId)
            ? requestedClassId
            : '';
        renderTeacherStudentAnalyticsModal();
    }
    function renderTeacherAnalytics() {
        const classSelect = document.getElementById('analytics-class-select');
        const classList = document.getElementById('analytics-class-list');
        const titleEl = document.getElementById('analytics-class-title');
        const summaryEl = document.getElementById('analytics-class-summary');
        const summaryListEl = document.getElementById('analytics-class-summary-list');
        const topEl = document.getElementById('analytics-top-students');
        const watchEl = document.getElementById('analytics-watch-students');
        const rosterEl = document.getElementById('analytics-class-roster');
        const classes = teacherAnalyticsState.classes || [];
        const selectedId = resolveTeacherActiveClassId(
            teacherAnalyticsState.selectedClassId,
            classes,
            accountSettings.teacher_analytics_default_class_id
        );
        const selected = selectedId ? teacherAnalyticsState.byClassId.get(selectedId) : null;

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
            if (rosterEl) rosterEl.innerHTML = `<p class="muted">${esc(teacherAnalyticsState.loading ? 'Loading roster analytics...' : 'No students to inspect yet.')}</p>`;
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
            summaryEl.textContent = `${formatCount(selected.studentCount, 'student')} across ${formatCount(selected.assignmentCount, 'assignment')}.${avgScore}${completion} Click any student below to open the full drill-down.${latest}${errorNote}`;
        }
        if (summaryListEl) summaryListEl.innerHTML = buildClassSummaryList(selected);
        renderStudentList('analytics-top-students', selected.topStudents, 'No top students yet.', { clickable: true, classId: selected.id });
        renderStudentList('analytics-watch-students', selected.watchStudents, 'No students need attention yet.', { clickable: true, classId: selected.id });
        renderStudentList('analytics-class-roster', selected.students, 'No students are enrolled in this class yet.', { clickable: true, classId: selected.id });
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
            teacherAnalyticsState.studentsById = new Map();
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
                    ? sb.from('assignments').select('id, class_id, title, due_date, created_at').in('class_id', classIds)
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
                    ? sb.from('user_drill_sessions').select('user_id, total, correct, dur, ts, buzz, items, results, meta, created_at').in('user_id', studentIds).gte('created_at', STUDY_DATA_RESET_CUTOFF_ISO)
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
            teacherAnalyticsState.studentsById = analytics.studentsById;
            teacherAnalyticsState.totals = analytics.totals;
            teacherAnalyticsState.selectedClassId = resolveTeacherActiveClassId(
                teacherAnalyticsState.selectedClassId,
                analytics.classes,
                accountSettings.teacher_analytics_default_class_id
            );
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
            teacherAnalyticsState.studentsById = new Map();
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
            teacherAnalyticsState.selectedClassId = resolveTeacherActiveClassId(
                teacherAnalyticsState.selectedClassId,
                teacherAnalyticsState.classes,
                accountSettings.teacher_analytics_default_class_id
            );
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
    const deleteBtn = document.getElementById('btn-delete-account');
    const revealDeleteBtn = document.getElementById('btn-reveal-delete');
    const dangerPanel = document.getElementById('account-danger-panel');
    const confirmDeleteReveal = document.getElementById('confirm-delete-reveal');
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
    function hasTeacherClassId(classId, classes = myClasses) {
        const normalizedId = normalizeTeacherClassId(classId);
        return !!normalizedId && (Array.isArray(classes) ? classes : []).some((row) => normalizeTeacherClassId(row?.id) === normalizedId);
    }
    function resolveTeacherActiveClassId(currentId, classes = myClasses, preferredId = accountSettings.teacher_analytics_default_class_id) {
        if (hasTeacherClassId(currentId, classes)) return normalizeTeacherClassId(currentId);
        return resolveTeacherClassOrFallback(preferredId, classes);
    }
    function resolveTeacherClassSelection(classId, classes = myClasses) {
        return hasTeacherClassId(classId, classes) ? normalizeTeacherClassId(classId) : '';
    }
    function resolveTeacherClassOrFallback(classId, classes = myClasses) {
        return resolveTeacherClassSelection(classId, classes) || normalizeTeacherClassId(classes?.[0]?.id);
    }
    function buildTeacherClassOptions(placeholder) {
        if (!myClasses.length) return '<option value="">No classes yet</option>';
        return [`<option value="">${esc(placeholder)}</option>`]
            .concat(myClasses.map((row) => `<option value="${esc(String(row.id || ''))}">${esc(row.name || 'Untitled Class')} (${esc(row.code || 'no code')})</option>`))
            .join('');
    }
    function populateTeacherSettingsClassDropdowns() {
        const builderSelect = document.getElementById('acc-teacher-default-class');
        const analyticsSelect = document.getElementById('acc-teacher-analytics-class');
        if (builderSelect) builderSelect.innerHTML = buildTeacherClassOptions('First available class');
        if (analyticsSelect) analyticsSelect.innerHTML = buildTeacherClassOptions('First available analytics class');
    }
    function readAccountSettingsFromForm() {
        return normalizeAccountSettings({
            ...accountSettings,
            teacher_builder_default_class_id: document.getElementById('acc-teacher-default-class')?.value,
            teacher_builder_default_mode: document.getElementById('acc-teacher-default-mode')?.value,
            teacher_builder_default_question_count: document.getElementById('acc-teacher-default-count')?.value,
            teacher_analytics_default_class_id: document.getElementById('acc-teacher-analytics-class')?.value
        });
    }
    function syncAccountSettingsInputs() {
        populateTeacherSettingsClassDropdowns();
        setInput('acc-teacher-default-mode', normalizeTeacherBuilderMode(accountSettings.teacher_builder_default_mode));
        setInput('acc-teacher-default-count', normalizeTeacherQuestionCount(accountSettings.teacher_builder_default_question_count));
        const builderSelect = document.getElementById('acc-teacher-default-class');
        const analyticsSelect = document.getElementById('acc-teacher-analytics-class');
        if (builderSelect) builderSelect.value = resolveTeacherClassSelection(accountSettings.teacher_builder_default_class_id, myClasses);
        if (analyticsSelect) analyticsSelect.value = resolveTeacherClassSelection(accountSettings.teacher_analytics_default_class_id, myClasses);
    }
    function applyAccountSettingsLocally({ force = false } = {}) {
        setMode(normalizeTeacherBuilderMode(accountSettings.teacher_builder_default_mode));
        const defaultQuestionCount = normalizeTeacherQuestionCount(accountSettings.teacher_builder_default_question_count);
        setInput('random-count', defaultQuestionCount);
        setInput('filter-count', defaultQuestionCount);

        const classSelect = document.getElementById('assign-class');
        if (classSelect) {
            const currentClassId = normalizeTeacherClassId(classSelect.value);
            const nextClassId = (force || !hasTeacherClassId(currentClassId, myClasses))
                ? resolveTeacherClassOrFallback(accountSettings.teacher_builder_default_class_id, myClasses)
                : currentClassId;
            classSelect.value = nextClassId;
        }

        const analyticsClasses = teacherAnalyticsState.classes.length ? teacherAnalyticsState.classes : myClasses;
        const currentAnalyticsId = normalizeTeacherClassId(teacherAnalyticsState.selectedClassId);
        if (force || !hasTeacherClassId(currentAnalyticsId, analyticsClasses)) {
            teacherAnalyticsState.selectedClassId = resolveTeacherClassOrFallback(accountSettings.teacher_analytics_default_class_id, analyticsClasses);
        }
        if (teacherAnalyticsState.classes.length) renderTeacherAnalytics();
    }
    function renderAccountProfile(forceSettings = false) {
        setInput('acc-display-name', profile.display_name || 'Unnamed');
        setInput('acc-role', formatRole(profile.role));
        setInput('acc-email', userEmail || '');
        setInput('acc-class-code', profile.class_code || '—');
        setInput('acc-created-at', profile.created_at ? new Date(profile.created_at).toLocaleString() : '—');
        setInput('acc-user-id', uid);
        selectedAvatarId = normalizeAvatarId(profile.avatar_id);
        renderAccountAvatarPreview();
        renderAccountAvatarPicker();
        accountSettings = normalizeAccountSettings(profile.account_settings);
        syncAccountSettingsInputs();
        applyAccountSettingsLocally({ force: forceSettings });
    }
    renderAccountProfile(true);

    ['acc-teacher-default-class', 'acc-teacher-default-mode', 'acc-teacher-default-count', 'acc-teacher-analytics-class'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', () => {
            accountSettings = readAccountSettingsFromForm();
            syncAccountSettingsInputs();
        });
    });

    
    const saveAccountBtns = document.querySelectorAll('.btn-save-account-action');
    const existingSaveBtn = document.getElementById('btn-save-account');
    const allSaveBtns = Array.from(saveAccountBtns);
    if (existingSaveBtn && !allSaveBtns.includes(existingSaveBtn)) allSaveBtns.push(existingSaveBtn);

    allSaveBtns.forEach(btn => btn?.addEventListener('click', async () => {
        const saveAccountBtn = btn;
        const nameInput = document.getElementById('acc-display-name');
        const emailInput = document.getElementById('acc-email');
        const passInput = document.getElementById('acc-password');
        if (!nameInput || !emailInput) return;

        const nextName = String(nameInput.value || '').trim();
        const nextEmail = normalizeEmail(emailInput.value);
        const nextPassword = passInput ? passInput.value : '';
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
        const nextAccountSettings = readAccountSettingsFromForm();
        const hasPersistedAccountSettings = !!profile.account_settings && typeof profile.account_settings === 'object' && !Array.isArray(profile.account_settings);
        const prevAccountSettings = normalizeAccountSettings(profile.account_settings);
        const changeName = nextName !== prevName;
        const changeEmail = nextEmail !== prevEmail;
        const changePass = !!nextPassword;
        const changeAvatar = nextAvatarId !== prevAvatarId;
        const changeSettings = !hasPersistedAccountSettings || JSON.stringify(nextAccountSettings) !== JSON.stringify(prevAccountSettings);
        
        if (!changeName && !changeEmail && !changeAvatar && !changeSettings && !changePass) {
            showAlert('No profile changes to save.', 'success');
            return;
        }

        const originalTexts = allSaveBtns.map(b => b.textContent);
        allSaveBtns.forEach(b => { b.disabled = true; b.textContent = 'Saving...'; });

        try {
            const successMsgs = [];
            const errorMsgs = [];

            if (changeName || changeAvatar || changeSettings) {
                const profilePatch = {};
                if (changeName) profilePatch.display_name = nextName;
                if (changeAvatar) profilePatch.avatar_id = nextAvatarId;
                if (changeSettings) profilePatch.account_settings = nextAccountSettings;
                const { error } = await sb.from('profiles').update(profilePatch).eq('id', uid);
                if (error) {
                    errorMsgs.push(`Profile update failed: ${error.message}`);
                } else {
                    if (changeName) {
                        profile.display_name = nextName;
                        successMsgs.push('Display name updated');
                    }
                    if (changeAvatar) {
                        profile.avatar_id = nextAvatarId;
                        successMsgs.push('Avatar updated');
                    }
                    if (changeSettings) {
                        accountSettings = normalizeAccountSettings(nextAccountSettings);
                        profile.account_settings = { ...accountSettings };
                        successMsgs.push('Workspace defaults saved');
                    }
                }
            }

            if (changeEmail || changePass) {
                const authPatch = {};
                if (changeEmail) authPatch.email = nextEmail;
                if (changePass) authPatch.password = nextPassword;
                const { data, error } = await sb.auth.updateUser(authPatch);
                if (error) {
                    errorMsgs.push(`Auth update failed: ${error.message}`);
                } else {
                    if (changeEmail) {
                        userEmail = String(data?.user?.email || data?.user?.new_email || nextEmail).trim();
                        successMsgs.push('Email change saved (check inbox to verify)');
                    }
                    if (changePass) {
                        successMsgs.push('Password updated securely');
                        if (passInput) passInput.value = '';
                    }
                }
            }

            if (!changeSettings) {
                accountSettings = nextAccountSettings;
            }
            renderAccountProfile(changeSettings);
            if (successMsgs.length && !errorMsgs.length) {
                showAlert(`${successMsgs.join('. ')}.`, 'success');
            } else if (successMsgs.length && errorMsgs.length) {
                showAlert(`${successMsgs.join('. ')}. ${errorMsgs.join(' ')}`, 'error');
            } else if (errorMsgs.length) {
                showAlert(errorMsgs.join(' '), 'error');
            }
        } catch (err) {
            showAlert(`Failed to save account changes: ${err?.message || err}`, 'error');
        } finally {
            allSaveBtns.forEach((b, i) => { b.disabled = false; b.textContent = originalTexts[i]; });
        }
    }));

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
        const { data, error } = await sb.from('classes').select('*').eq('teacher_id', uid).order('created_at', { ascending: false });
        myClasses = data || [];
        renderClasses();
        populateClassDropdown();
        syncAccountSettingsInputs();
        applyAccountSettingsLocally();
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
    function showModal(title, bodyHtml, options = {}) {
        const modal = document.getElementById('teacher-modal');
        const modalCard = document.getElementById('teacher-modal-card');
        document.getElementById('modal-title').textContent = title;
        const body = document.getElementById('modal-body');
        body.className = options.bodyClass ? `list-container ${options.bodyClass}` : 'list-container';
        body.innerHTML = bodyHtml;
        if (modalCard) {
            modalCard.className = `modal-card card${options.wide ? ' teacher-modal-wide' : ''}${options.cardClass ? ` ${options.cardClass}` : ''}`;
        }
        hydrateAvatarImages(body);
        modal.classList.remove('hidden');
    }
    const closeTeacherModal = () => {
        document.getElementById('teacher-modal').classList.add('hidden');
    };
    document.getElementById('modal-close').addEventListener('click', () => {
        closeTeacherModal();
    });
    document.getElementById('teacher-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeTeacherModal();
    });
    document.getElementById('modal-body').addEventListener('change', (event) => {
        if (event.target?.id !== 'student-analytics-class-select') return;
        teacherStudentDetailState.selectedClassId = String(event.target.value || '').trim();
        renderTeacherStudentAnalyticsModal();
    });
    document.getElementById('modal-body').addEventListener('click', (event) => {
        const classRow = event.target.closest('[data-student-detail-class-id]');
        if (!classRow) return;
        teacherStudentDetailState.selectedClassId = String(classRow.dataset.studentDetailClassId || '').trim();
        renderTeacherStudentAnalyticsModal();
    });
    document.getElementById('modal-body').addEventListener('keydown', (event) => {
        const classRow = event.target.closest('[data-student-detail-class-id]');
        if (!classRow) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        teacherStudentDetailState.selectedClassId = String(classRow.dataset.studentDetailClassId || '').trim();
        renderTeacherStudentAnalyticsModal();
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
    const handleAnalyticsStudentOpen = (event) => {
        const trigger = event.target.closest('[data-analytics-student-id]');
        if (!trigger) return;
        openTeacherStudentAnalytics(trigger.dataset.analyticsStudentId, trigger.dataset.analyticsStudentClassId);
    };
    const handleAnalyticsStudentKeydown = (event) => {
        const trigger = event.target.closest('[data-analytics-student-id]');
        if (!trigger) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openTeacherStudentAnalytics(trigger.dataset.analyticsStudentId, trigger.dataset.analyticsStudentClassId);
    };
    ['analytics-top-students', 'analytics-watch-students', 'analytics-class-roster'].forEach((id) => {
        const el = document.getElementById(id);
        el?.addEventListener('click', handleAnalyticsStudentOpen);
        el?.addEventListener('keydown', handleAnalyticsStudentKeydown);
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
        if (!sel) return;
        const currentClassId = normalizeTeacherClassId(sel.value);
        sel.innerHTML = myClasses.length
            ? myClasses.map(c => `<option value="${c.id}">${esc(c.name)} (${c.code})</option>`).join('')
            : '<option value="">Create a class first</option>';
        sel.value = hasTeacherClassId(currentClassId, myClasses)
            ? currentClassId
            : resolveTeacherClassOrFallback(accountSettings.teacher_builder_default_class_id, myClasses);
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
    setMode(normalizeTeacherBuilderMode(accountSettings.teacher_builder_default_mode || modeButtons.find(b => b.classList.contains('active'))?.dataset.mode || 'random'));
    loadClasses();
    loadAssignments();
});
