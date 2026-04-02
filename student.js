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
    const KEY_WRONG = 'ihbb_v2_wrong_srs';
    const COACH_CHAT_NAV_STORAGE_KEY = 'ihbb_v2_coach_chat_action';
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
    const isNotebookCoachRecord = (record) => !!record && !record.correct;
    const DASHBOARD_CHAT_STARTERS = [
        { label: 'What next?', prompt: 'What should I practice next from my student dashboard?' },
        { label: 'Notebook or wrong-bank?', prompt: 'Should I use AI Notebook or Wrong-bank right now?' },
        { label: 'Build a focused drill', prompt: 'Recommend a focused drill and send me into training.' }
    ];
    const DASHBOARD_CHAT_ALLOWED_ACTIONS = new Set([
        'practice_due_now',
        'review_last_misses',
        'open_ai_notebook',
        'apply_top_focus',
        'generate_focus_drill',
        'start_current_session',
        'open_setup',
        'open_review',
        'open_library'
    ]);
    const DASHBOARD_CHAT_UI_KEY = `ihbb_student_dashboard_chat_ui_${uid}`;
    const DASHBOARD_CHAT_SIZE_PRESETS = {
        standard: 820,
        wide: 980,
        focus: 1140
    };
    const dashboardChat = {
        open: false,
        busy: false,
        source: 'ready',
        messages: [],
        currentStarters: [],
        suggestedReason: 'manual',
        workspaceCards: [],
        ui: {
            mode: 'auto',
            size: 'standard',
            width: DASHBOARD_CHAT_SIZE_PRESETS.standard,
            fullscreen: false
        },
        resizing: null
    };

    function clampDashboardChatWidth(value) {
        const min = 720;
        const max = Math.max(min, window.innerWidth - 32);
        const parsed = Number(value);
        return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : DASHBOARD_CHAT_SIZE_PRESETS.standard));
    }

    function loadDashboardChatUiPrefs() {
        try {
            const raw = JSON.parse(localStorage.getItem(DASHBOARD_CHAT_UI_KEY) || '{}');
            const mode = ['auto', 'coach', 'knowledge'].includes(String(raw.mode || '').trim()) ? String(raw.mode).trim() : 'auto';
            const sizeRaw = String(raw.size || '').trim();
            const size = sizeRaw === 'custom' || Object.prototype.hasOwnProperty.call(DASHBOARD_CHAT_SIZE_PRESETS, sizeRaw) ? sizeRaw : 'standard';
            dashboardChat.ui = {
                mode,
                size,
                width: clampDashboardChatWidth(raw.width || DASHBOARD_CHAT_SIZE_PRESETS[size] || DASHBOARD_CHAT_SIZE_PRESETS.standard),
                fullscreen: !!raw.fullscreen
            };
        } catch {
            dashboardChat.ui = {
                mode: 'auto',
                size: 'standard',
                width: DASHBOARD_CHAT_SIZE_PRESETS.standard,
                fullscreen: false
            };
        }
    }

    function saveDashboardChatUiPrefs() {
        try {
            localStorage.setItem(DASHBOARD_CHAT_UI_KEY, JSON.stringify({
                mode: dashboardChat.ui.mode,
                size: dashboardChat.ui.size,
                width: dashboardChat.ui.width,
                fullscreen: dashboardChat.ui.fullscreen
            }));
        } catch { /* noop */ }
    }

    loadDashboardChatUiPrefs();

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
        renderDashboardChatChrome();
    }

    function readWrongBankState() {
        const raw = safeReadJson(KEY_WRONG, {});
        const state = raw && typeof raw === 'object' ? raw : {};
        const entries = Object.values(state);
        const now = Date.now();
        const dueNow = entries.filter(entry => Number(entry?.dueAt || 0) <= now).length;
        return { total: entries.length, dueNow };
    }

    function coachChatFocusTitle(focus) {
        return [focus?.region, focus?.era, focus?.topic].filter(Boolean).join(' • ') || String(focus?.title || '').trim() || 'Top focus';
    }

    function buildDashboardChatContext() {
        const sessions = safeReadJson(KEY_SESS, []);
        const recentSessions = Array.isArray(sessions) ? sessions.slice(0, 5) : [];
        const lastSession = recentSessions[0] || null;
        const recentAccuracy = recentSessions.length
            ? Math.round(recentSessions.reduce((sum, session) => sum + Number(session?.acc || 0), 0) / recentSessions.length)
            : 0;
        const daysSinceLastSession = Number(lastSession?.ts || 0)
            ? Math.max(0, Math.floor((Date.now() - Number(lastSession.ts)) / DAY_MS))
            : 0;
        const wrongBank = readWrongBankState();
        const topFocuses = (Array.isArray(coachFocusSuggestionsCurrent) ? coachFocusSuggestionsCurrent : []).slice(0, 4).map(focus => ({
            key: String(focus?.key || '').trim(),
            title: String(focus?.title || '').trim(),
            region: String(focus?.region || '').trim(),
            era: String(focus?.era || '').trim(),
            topic: String(focus?.topic || '').trim(),
            priority: String(focus?.priority || 'medium').trim(),
            reason: String(focus?.reason || '').trim(),
            action: String(focus?.action || '').trim()
        }));
        const recentRecord = Array.isArray(coachRecordsCurrent) && coachRecordsCurrent.length ? coachRecordsCurrent[0] : null;
        const recentFocus = recentRecord ? coachFocusFromRecord(recentRecord) : {};
        const activeTab = document.querySelector('.dash-tab.active')?.dataset?.tab || 'classes';
        return {
            current_view: `dashboard-${activeTab}`,
            wrong_bank: {
                due_now: wrongBank.dueNow,
                total: wrongBank.total
            },
            coach_notebook: {
                total: Array.isArray(coachRecordsCurrent) ? coachRecordsCurrent.length : 0,
                open_lessons: Array.isArray(coachRecordsCurrent) ? coachRecordsCurrent.filter(record => !record.mastered).length : 0,
                top_focuses: topFocuses
            },
            session_history: {
                total_sessions: Array.isArray(sessions) ? sessions.length : 0,
                recent_accuracy: recentAccuracy,
                days_since_last_session: daysSinceLastSession,
                last_session: lastSession ? {
                    accuracy: Number(lastSession.acc || 0),
                    total: Number(lastSession.total || 0),
                    correct: Number(lastSession.correct || 0),
                    duration_seconds: Number(lastSession.dur || 0),
                    timestamp: Number(lastSession.ts || 0)
                } : null
            },
            setup: {
                mode: 'Practice Hub',
                length: 'Use Practice Drill to choose length',
                filters: 'Coach and analytics suggestions are synced here'
            },
            active_set: {
                name: 'Practice Hub',
                item_count: 0
            },
            recent_incorrect: recentRecord ? {
                key: [recentFocus.region, recentFocus.era, recentFocus.topic].filter(Boolean).join('|'),
                title: coachChatFocusTitle({
                    title: [recentFocus.region, recentFocus.era, recentFocus.topic].filter(Boolean).join(' • ')
                }),
                region: String(recentFocus.region || '').trim(),
                era: String(recentFocus.era || '').trim(),
                topic: String(recentFocus.topic || '').trim(),
                reason: String(recentRecord?.coach?.summary || recentRecord?.reason || '').trim(),
                attempt_id: String(recentRecord?.client_attempt_id || '').trim()
            } : null,
            analytics: analyticsSnapshotCurrent ? {
                total_attempts: Number(analyticsSnapshotCurrent.totalAttempts || 0),
                total_accuracy: Number(analyticsSnapshotCurrent.totalAccuracy || 0),
                blind_spots: Array.isArray(analyticsSnapshotCurrent.blindSpots)
                    ? analyticsSnapshotCurrent.blindSpots.slice(0, 3).map(spot => ({
                        title: String(spot?.title || '').trim(),
                        priority: String(spot?.priority || 'medium').trim()
                    }))
                    : []
            } : null
        };
    }

    function buildDashboardChatSummary(snapshot) {
        const recent = snapshot?.recent_incorrect;
        const topFocus = snapshot?.coach_notebook?.top_focuses?.[0];
        if (dashboardChat.ui.mode === 'knowledge') return 'Ask for explanations, timelines, comparisons, or background on any IHBB topic.';
        if (recent?.title) return `Last miss: ${recent.title}.`;
        if ((snapshot?.wrong_bank?.due_now || 0) > 0) return `${snapshot.wrong_bank.due_now} wrong-bank card${snapshot.wrong_bank.due_now === 1 ? '' : 's'} due now.`;
        if (topFocus?.title) return `Top coach focus: ${topFocus.title}.`;
        if ((snapshot?.session_history?.total_sessions || 0) <= 0) return 'No recent practice history yet.';
        return 'Ask what to study next before your next drill or assignment.';
    }

    function updateDashboardChatSourceLabel() {
        const el = document.getElementById('coach-chat-source');
        if (!el) return;
        let label = 'Ready';
        if (dashboardChat.busy) label = 'Thinking';
        else if (dashboardChat.source === 'deepseek') label = 'DeepSeek';
        else if (dashboardChat.source === 'fallback') label = 'Local plan';
        el.textContent = `${label} • ${dashboardChat.ui.mode === 'knowledge' ? 'Knowledge' : (dashboardChat.ui.mode === 'coach' ? 'Coach' : 'Auto')}`;
    }

    function resolveDashboardChatMode(message = '', snapshot = buildDashboardChatContext()) {
        if (dashboardChat.ui.mode === 'coach' || dashboardChat.ui.mode === 'knowledge') return dashboardChat.ui.mode;
        const prompt = String(message || '').trim().toLowerCase();
        const coachTerms = ['wrong bank', 'wrong-bank', 'srs', 'notebook', 'ai notebook', 'lesson', 'coach', 'practice', 'train', 'drill', 'session', 'review', 'setup', 'focus', 'assignment'];
        const knowledgeTerms = ['who ', 'what ', 'when ', 'where ', 'why ', 'how ', 'explain', 'define', 'describe', 'summarize', 'summary', 'timeline', 'compare', 'contrast', 'significance', 'overview', 'background', 'concept'];
        if (coachTerms.some(term => prompt.includes(term))) return 'coach';
        if (knowledgeTerms.some(term => prompt.includes(term))) return 'knowledge';
        if (!(snapshot?.session_history?.total_sessions || 0) && !(snapshot?.coach_notebook?.total || 0)) return 'knowledge';
        return 'coach';
    }

    function dashboardChatTopicFromMessage(message = '', snapshot = buildDashboardChatContext(), mode = resolveDashboardChatMode(message, snapshot)) {
        const raw = String(message || '').trim();
        const recentTitle = String(snapshot?.recent_incorrect?.title || '').trim();
        const topFocusTitle = String(snapshot?.coach_notebook?.top_focuses?.[0]?.title || '').trim();
        if (!raw) return mode === 'knowledge' ? (recentTitle || topFocusTitle) : recentTitle;
        const prompt = raw
            .replace(/^[^a-zA-Z0-9]*(who|what|when|where|why|how)\s+(is|was|were|are|did|do|does)\s+/i, '')
            .replace(/^(explain|define|describe|outline|summarize|compare|contrast|tell me about|give me (a )?timeline of|what is the significance of|what was the significance of|what caused|what were the causes of|what happened in)\s+/i, '')
            .replace(/[?.!]+$/g, '')
            .trim();
        return prompt || recentTitle || topFocusTitle;
    }

    function dashboardChatWikiLink(topic = '') {
        const clean = String(topic || '').trim().replace(/[?.!]+$/g, '');
        return clean ? `https://en.wikipedia.org/wiki/${encodeURIComponent(clean.replace(/\s+/g, '_'))}` : '';
    }

    function normalizeDashboardChatSections(raw) {
        return Array.isArray(raw)
            ? raw.map(section => {
                const heading = String(section?.heading || section?.title || '').trim();
                const body = String(section?.body || section?.text || section?.content || '').trim();
                return heading && body ? { heading, body } : null;
            }).filter(Boolean).slice(0, 4)
            : [];
    }

    function normalizeDashboardChatLinks(raw) {
        return Array.isArray(raw)
            ? raw.map(link => {
                const label = String(link?.label || link?.title || '').trim();
                const url = String(link?.url || '').trim();
                if (!label || !/^https:\/\//i.test(url)) return null;
                return { label, url, kind: String(link?.kind || link?.type || 'reference').trim() || 'reference' };
            }).filter(Boolean).slice(0, 4)
            : [];
    }

    function normalizeDashboardChatFollowUps(raw) {
        return Array.isArray(raw)
            ? raw.map(item => {
                const label = String(item?.label || item?.title || '').trim();
                const prompt = String(item?.prompt || item?.message || '').trim();
                return label && prompt ? { label, prompt } : null;
            }).filter(Boolean).slice(0, 4)
            : [];
    }

    function normalizeDashboardChatHighlights(raw) {
        return Array.isArray(raw)
            ? raw.map(item => String(item || '').trim()).filter(Boolean).slice(0, 4)
            : [];
    }

    function isDashboardChatPristine() {
        return !dashboardChat.busy && !dashboardChat.messages.length;
    }

    function limitDashboardChatStarters(list = []) {
        return list.slice(0, isDashboardChatPristine() ? 2 : 3);
    }

    function buildDashboardChatStarters(snapshot = buildDashboardChatContext()) {
        const recent = snapshot?.recent_incorrect || null;
        const wrongDue = snapshot?.wrong_bank?.due_now || 0;
        const notebookOpen = snapshot?.coach_notebook?.open_lessons || 0;
        const topFocus = snapshot?.coach_notebook?.top_focuses?.[0] || null;
        const topFocusTitle = coachChatFocusTitle(topFocus);
        const recentTitle = String(recent?.title || '').trim();
        const knowledgeTopic = recentTitle || topFocusTitle || 'this topic';
        if (dashboardChat.ui.mode === 'knowledge') {
            return limitDashboardChatStarters([
                { label: 'Explain it', prompt: `Explain ${knowledgeTopic} in detail and why it matters in IHBB.` },
                { label: 'Give a timeline', prompt: `Give me a clear timeline of ${knowledgeTopic}.` },
                { label: 'Common confusions', prompt: `What are the most common confusions or mix-ups around ${knowledgeTopic}?` }
            ]);
        }
        if (recentTitle) {
            return limitDashboardChatStarters([
                { label: 'Last miss', prompt: `Why did I miss ${recentTitle}, and what should I train next?` },
                { label: 'Best tool', prompt: `For ${recentTitle}, should I use AI Notebook, Wrong-bank, or a guided drill first?` },
                { label: 'Corrective drill', prompt: `Build me a corrective practice plan for ${recentTitle}.` }
            ]);
        }
        if (wrongDue >= 3) {
            return limitDashboardChatStarters([
                { label: 'Wrong-bank first', prompt: `I have ${wrongDue} due wrong-bank cards. Should I clear those before anything else?` },
                { label: 'After review', prompt: 'After my due wrong-bank review, what should I practice next from the dashboard?' },
                { label: 'Fresh drill', prompt: topFocusTitle ? `After wrong-bank, should I turn ${topFocusTitle} into a fresh drill?` : 'What is the best fresh drill after my due wrong-bank review?' }
            ]);
        }
        if ((dashboardChat.suggestedReason === 'notebook' || notebookOpen > 0) && topFocusTitle) {
            return limitDashboardChatStarters([
                { label: 'Notebook focus', prompt: `Which AI Notebook focus should I train next if ${topFocusTitle} keeps showing up?` },
                { label: 'From lesson to drill', prompt: `How should I turn ${topFocusTitle} from AI Notebook into actual practice?` },
                { label: 'Before assignment', prompt: `Before my next assignment, is ${topFocusTitle} better for notebook review or a targeted drill?` }
            ]);
        }
        return limitDashboardChatStarters(DASHBOARD_CHAT_STARTERS);
    }

    function renderDashboardChatStarters(snapshot) {
        const el = document.getElementById('coach-chat-starters');
        if (!el) return;
        dashboardChat.currentStarters = buildDashboardChatStarters(snapshot);
        el.innerHTML = dashboardChat.currentStarters.map((starter, index) => `
            <button class="coach-chat-starter" type="button" data-starter-index="${index}">
                <span class="coach-chat-starter-label">${esc(starter.label || 'Suggested question')}</span>
                <span class="coach-chat-starter-text">${esc(starter.prompt || '')}</span>
            </button>
        `).join('');
    }

    function renderDashboardChatWorkspace(snapshot) {
        const el = document.getElementById('coach-chat-workspace');
        if (!el) return;
        const topFocus = snapshot?.coach_notebook?.top_focuses?.[0] || null;
        const knowledgeCard = {
            kicker: 'Ask',
            title: dashboardChat.ui.mode === 'knowledge' ? 'Knowledge mode' : 'Concept help',
            copy: 'Explain a topic, get a timeline, or compare two ideas.',
            action: { kind: 'mode', mode: 'knowledge', label: dashboardChat.ui.mode === 'knowledge' ? 'Knowledge mode active' : 'Switch to Knowledge' }
        };
        const primaryCard = (snapshot?.wrong_bank?.due_now || 0) > 0
            ? {
                kicker: 'Next step',
                title: `Review ${snapshot.wrong_bank.due_now} due`,
                copy: 'Clear the due queue first.',
                action: { kind: 'action', id: 'practice_due_now', label: 'Start due review' }
            }
            : topFocus?.key
                ? {
                    kicker: 'Next step',
                    title: topFocus.title,
                    copy: 'Top saved focus.',
                    action: { kind: 'action', id: 'apply_top_focus', focus_key: topFocus.key, label: `Apply ${topFocus.title}` }
                }
                : {
                    kicker: 'Next step',
                    title: 'Open Practice Hub',
                    copy: 'Start a drill or search the library.',
                    action: { kind: 'action', id: 'start_current_session', label: 'Open Practice Hub' }
                };
        const cards = isDashboardChatPristine()
            ? [primaryCard, knowledgeCard]
            : [
                {
                    kicker: 'Wrong-bank',
                    title: (snapshot?.wrong_bank?.due_now || 0) > 0 ? `Review ${snapshot.wrong_bank.due_now} due` : 'Wrong-bank',
                    copy: (snapshot?.wrong_bank?.due_now || 0) > 0 ? 'Best next review block' : 'Use after new misses',
                    action: (snapshot?.wrong_bank?.due_now || 0) > 0
                        ? { kind: 'action', id: 'practice_due_now', label: 'Start due review' }
                        : { kind: 'prompt', label: 'Ask when to use it', prompt: 'When is Wrong-bank better than a fresh drill?' }
                },
                {
                    kicker: 'AI Notebook',
                    title: topFocus?.title || 'Open Notebook',
                    copy: topFocus?.title ? 'Top saved focus' : `${snapshot?.coach_notebook?.open_lessons || 0} open lesson${(snapshot?.coach_notebook?.open_lessons || 0) === 1 ? '' : 's'}`,
                    action: topFocus?.key
                        ? { kind: 'action', id: 'apply_top_focus', focus_key: topFocus.key, label: `Apply ${topFocus.title}` }
                        : { kind: 'action', id: 'open_ai_notebook', label: 'Open Notebook' }
                },
                {
                    kicker: 'Practice Hub',
                    title: 'Open Practice Hub',
                    copy: 'Start a drill or search the library',
                    action: { kind: 'action', id: 'start_current_session', label: 'Open Practice Hub' }
                },
                knowledgeCard
            ];
        el.innerHTML = cards.map((card, index) => `
            <button class="coach-chat-workspace-card" type="button" data-workspace-index="${index}">
                <span class="coach-chat-workspace-kicker">${esc(card.kicker)}</span>
                <span class="coach-chat-workspace-title">${esc(card.title)}</span>
                <span class="coach-chat-workspace-copy">${esc(card.copy)}</span>
            </button>
        `).join('');
        dashboardChat.workspaceCards = cards;
    }

    function renderDashboardChatMessages() {
        const bodyEl = document.getElementById('coach-chat-body');
        const el = document.getElementById('coach-chat-messages');
        if (!el) return;
        const messagesHtml = dashboardChat.messages.map((message, messageIndex) => `
            <div class="coach-chat-message ${message.role === 'user' ? 'user' : 'assistant'}">
                <div class="coach-chat-message-meta">
                    <span>${esc(message.role === 'user' ? 'You' : (message.source === 'deepseek' ? 'DeepSeek' : 'Local plan'))}</span>
                    <span>${esc(message.role === 'user' ? 'Prompt' : (message.mode === 'knowledge' ? 'Knowledge brief' : 'Coach advice'))}</span>
                </div>
                ${message.role === 'assistant' && message.title ? `<h3 class="coach-chat-message-title">${esc(message.title)}</h3>` : ''}
                <p class="coach-chat-message-text">${esc(message.text || '')}</p>
                ${Array.isArray(message.highlights) && message.highlights.length ? `<div class="coach-chat-highlights">${message.highlights.map(item => `<span class="coach-chat-highlight">${esc(item)}</span>`).join('')}</div>` : ''}
                ${Array.isArray(message.sections) && message.sections.length ? `<div class="coach-chat-sections">${message.sections.map(section => `
                    <div class="coach-chat-section-card">
                        <h4>${esc(section.heading)}</h4>
                        <p>${esc(section.body)}</p>
                    </div>
                `).join('')}</div>` : ''}
                ${Array.isArray(message.links) && message.links.length ? `<div class="coach-chat-links">${message.links.map(link => `
                    <a class="coach-chat-link-card" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.label)}</a>
                `).join('')}</div>` : ''}
                ${Array.isArray(message.followUps) && message.followUps.length ? `<div class="coach-chat-followups">${message.followUps.map((followUp, followUpIndex) => `
                    <button class="coach-chat-followup" type="button" data-message-index="${messageIndex}" data-followup-index="${followUpIndex}">${esc(followUp.label)}</button>
                `).join('')}</div>` : ''}
                ${Array.isArray(message.actions) && message.actions.length ? `
                    <div class="coach-chat-actions">
                        ${message.actions.map((action, actionIndex) => `
                            <button class="coach-chat-action" type="button" data-message-index="${messageIndex}" data-action-index="${actionIndex}">
                                <span class="coach-chat-action-label">${esc(action.label || 'Run action')}</span>
                                <span class="coach-chat-action-reason">${esc(action.reason || 'Recommended from your current dashboard state.')}</span>
                            </button>
                        `).join('')}
                    </div>
                ` : ''}
                ${message.role === 'assistant' ? `<div class="coach-chat-message-tools"><button class="coach-chat-tool" type="button" data-message-index="${messageIndex}" data-tool="copy">Copy answer</button></div>` : ''}
            </div>
        `).join('');
        const loadingHtml = dashboardChat.busy ? `
            <div class="coach-chat-message assistant coach-chat-thinking">
                <div class="coach-chat-message-meta">
                    <span>DeepSeek</span>
                    <span>Thinking</span>
                </div>
                <div class="coach-chat-thinking-bubble">
                    <div class="coach-chat-thinking-dots" aria-hidden="true"><span></span><span></span><span></span></div>
                    <div class="coach-chat-loading">${dashboardChat.ui.mode === 'knowledge' ? 'DeepSeek is building a detailed study brief with references.' : 'DeepSeek is reviewing your coach history, wrong-bank, and analytics.'}</div>
                </div>
            </div>
        ` : '';
        el.innerHTML = messagesHtml || loadingHtml
            ? `${messagesHtml}${loadingHtml}`
            : `<div class="coach-chat-empty">
                <div class="coach-chat-empty-title">${dashboardChat.ui.mode === 'knowledge' ? 'Ask about any IHBB topic.' : 'Start with one quick question.'}</div>
                <p class="coach-chat-empty-text">${dashboardChat.ui.mode === 'knowledge'
                    ? 'Pick a prompt or type a topic when you want an explanation, timeline, or comparison.'
                    : 'Pick a prompt or type what you want to practice next.'}</p>
            </div>`;
        if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
        el.scrollTop = el.scrollHeight;
    }

    function setDashboardChatOpenState(open) {
        dashboardChat.open = !!open;
        const launcher = document.getElementById('coach-chat-launcher');
        const sidebar = document.getElementById('coach-chat-sidebar');
        const backdrop = document.getElementById('coach-chat-backdrop');
        if (launcher) launcher.setAttribute('aria-expanded', dashboardChat.open ? 'true' : 'false');
        if (sidebar) {
            sidebar.classList.toggle('open', dashboardChat.open);
            sidebar.classList.toggle('fullscreen', !!dashboardChat.ui.fullscreen);
            sidebar.setAttribute('aria-hidden', dashboardChat.open ? 'false' : 'true');
            sidebar.dataset.chatPristine = isDashboardChatPristine() ? 'true' : 'false';
            sidebar.style.setProperty('--coach-chat-width', `${clampDashboardChatWidth(dashboardChat.ui.width)}px`);
        }
        if (backdrop) backdrop.hidden = !dashboardChat.open;
        document.body.classList.toggle('coach-chat-open', dashboardChat.open);
    }

    function renderDashboardChatChrome() {
        const snapshot = buildDashboardChatContext();
        const summaryEl = document.getElementById('coach-chat-context-summary');
        const pillsEl = document.getElementById('coach-chat-status-pills');
        const noteEl = document.getElementById('coach-chat-launcher-note');
        const countEl = document.getElementById('coach-chat-launcher-count');
        const hintEl = document.getElementById('coach-chat-hint');
        const sendBtn = document.getElementById('coach-chat-send');
        const modeButtons = Array.from(document.querySelectorAll('#coach-chat-mode-switch .coach-chat-mode-btn'));
        const sizeButtons = Array.from(document.querySelectorAll('#coach-chat-size-presets .coach-chat-size-btn'));
        const fullBtn = document.getElementById('coach-chat-fullscreen');

        if (summaryEl) summaryEl.textContent = buildDashboardChatSummary(snapshot);
        if (pillsEl) {
            const pills = [];
            if (dashboardChat.ui.mode === 'knowledge') pills.push('Knowledge mode');
            if ((snapshot?.wrong_bank?.due_now || 0) > 0) pills.push(`Wrong-bank due ${snapshot.wrong_bank.due_now}`);
            if ((snapshot?.coach_notebook?.open_lessons || 0) > 0) pills.push(`Notebook open ${snapshot.coach_notebook.open_lessons}`);
            if (dashboardChat.ui.mode !== 'knowledge' && (snapshot?.session_history?.recent_accuracy || 0) > 0) pills.push(`Recent accuracy ${snapshot.session_history.recent_accuracy}%`);
            if (!pills.length && snapshot?.coach_notebook?.top_focuses?.[0]?.title) pills.push(snapshot.coach_notebook.top_focuses[0].title);
            pillsEl.innerHTML = pills.length
                ? pills.slice(0, 2).map(text => `<span class="coach-chat-status-pill">${esc(text)}</span>`).join('')
                : `<span class="coach-chat-status-pill">${dashboardChat.ui.mode === 'knowledge' ? 'Concept help ready.' : 'Study help ready.'}</span>`;
        }
        if (noteEl) {
            if (dashboardChat.ui.mode === 'knowledge') noteEl.textContent = 'Ask any concept';
            else if (snapshot?.recent_incorrect?.title) noteEl.textContent = 'Fix the last miss';
            else if ((snapshot?.wrong_bank?.due_now || 0) > 0) noteEl.textContent = `${snapshot.wrong_bank.due_now} due in Wrong-bank`;
            else if ((snapshot?.coach_notebook?.open_lessons || 0) > 0) noteEl.textContent = `${snapshot.coach_notebook.open_lessons} coach lesson${snapshot.coach_notebook.open_lessons === 1 ? '' : 's'}`;
            else noteEl.textContent = 'Open coach chat';
        }
        if (countEl) {
            const count = Math.max(snapshot?.wrong_bank?.due_now || 0, snapshot?.coach_notebook?.open_lessons || 0);
            countEl.textContent = String(count || 0);
            countEl.classList.toggle('hidden', !count);
        }
        if (hintEl) {
            hintEl.textContent = dashboardChat.ui.mode === 'knowledge'
                ? 'Knowledge mode gives long-form explanations and reference links.'
                : 'Coach mode stays tied to your dashboard context and only answers when asked.';
        }
        if (sendBtn) sendBtn.disabled = !!dashboardChat.busy;
        modeButtons.forEach(button => {
            const active = String(button.dataset.mode || '') === dashboardChat.ui.mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        sizeButtons.forEach(button => {
            const active = String(button.dataset.size || '') === dashboardChat.ui.size && !dashboardChat.ui.fullscreen;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (fullBtn) {
            fullBtn.textContent = dashboardChat.ui.fullscreen ? 'Windowed' : 'Full Screen';
            fullBtn.setAttribute('aria-pressed', dashboardChat.ui.fullscreen ? 'true' : 'false');
        }

        renderDashboardChatWorkspace(snapshot);
        renderDashboardChatStarters(snapshot);
        renderDashboardChatMessages();
        updateDashboardChatSourceLabel();
        setDashboardChatOpenState(dashboardChat.open);
    }

    function normalizeDashboardChatActions(actions) {
        const out = [];
        const seen = new Set();
        for (const action of (Array.isArray(actions) ? actions : [])) {
            const id = String(action?.id || '').trim();
            const focusKey = String(action?.focus_key || '').trim();
            const query = String(action?.query || '').trim();
            if (!DASHBOARD_CHAT_ALLOWED_ACTIONS.has(id)) continue;
            const key = `${id}|${focusKey}|${query}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                id,
                label: String(action?.label || '').trim() || id.replace(/_/g, ' '),
                reason: String(action?.reason || '').trim() || 'Recommended from your current dashboard state.',
                focus_key: focusKey,
                query
            });
        }
        return out.slice(0, 3);
    }

    function buildDashboardChatFallback(message) {
        const snapshot = buildDashboardChatContext();
        const prompt = String(message || '').trim().toLowerCase();
        const mode = resolveDashboardChatMode(message, snapshot);
        const wrongDue = snapshot?.wrong_bank?.due_now || 0;
        const notebookOpen = snapshot?.coach_notebook?.open_lessons || 0;
        const topFocus = snapshot?.coach_notebook?.top_focuses?.[0] || null;
        const topFocusTitle = coachChatFocusTitle(topFocus);
        const topFocusKey = String(topFocus?.key || '').trim();
        const recent = snapshot?.recent_incorrect || null;
        const topic = dashboardChatTopicFromMessage(message, snapshot, mode);
        const actions = [];
        let reply = '';
        let title = 'Dashboard plan';

        if (mode === 'knowledge') {
            const wiki = dashboardChatWikiLink(topic);
            return {
                source: 'fallback',
                mode: 'knowledge',
                title: topic ? `Study brief: ${topic}` : 'Study brief',
                topic,
                message: topic
                    ? `This looks like a knowledge question about ${topic}. When DeepSeek is available, I can answer it in full detail here. Right now I can still structure the topic, suggest the best follow-up prompts, and give you a reference link.`
                    : 'This looks like a knowledge question. When DeepSeek is available, I can answer it in full detail here. Right now I can still frame the topic and suggest the best follow-up prompts.',
                highlights: ['Knowledge mode', topic ? 'Wikipedia reference ready' : 'Reference lookup ready'].filter(Boolean),
                sections: [
                    { heading: 'What to lock in first', body: topic ? `Start with the definition, timeframe, main actors, and why ${topic} matters in the broader historical story.` : 'Start with the definition, timeframe, main actors, and why the topic matters in the broader historical story.' },
                    { heading: 'What IHBB usually rewards', body: 'Be ready to explain causes, turning points, significance, comparisons, and the larger regional or chronological pattern around the concept.' },
                    { heading: 'Best follow-up prompts', body: 'Ask for a timeline, significance, comparison, common confusions, or likely clue patterns if you want a stronger study brief.' }
                ],
                links: wiki ? [{ label: `Wikipedia: ${topic}`, url: wiki, kind: 'wikipedia' }] : [],
                follow_ups: [
                    { label: 'Give me a timeline', prompt: topic ? `Give me a clear timeline of ${topic}.` : 'Give me a clear timeline of this topic.' },
                    { label: 'Why it matters', prompt: topic ? `Why is ${topic} historically significant?` : 'Why is this topic historically significant?' },
                    { label: 'Common confusions', prompt: topic ? `What are the most common confusions around ${topic}?` : 'What are the most common confusions around this topic?' }
                ],
                quick_actions: normalizeDashboardChatActions(topic ? [{ id: 'open_library', label: `Search ${topic}`, reason: 'Open the Practice Hub library and search this topic.', query: topic }] : [])
            };
        }

        if (prompt.includes('wrong-bank') || prompt.includes('wrong bank') || prompt.includes('srs')) {
            title = wrongDue > 0 ? 'Clear due review first' : 'Wrong-bank is not the blocker right now';
            reply = wrongDue > 0
                ? `Wrong-bank is useful now because ${wrongDue} card${wrongDue === 1 ? '' : 's'} are due. Use the Practice Hub to clear those before adding more mixed volume.`
                : 'Wrong-bank is best after you build up misses in regular drills. Nothing is due yet, so a focused coach drill is the better move.';
            if (wrongDue > 0) actions.push({ id: 'practice_due_now', label: `Practice ${wrongDue} due card${wrongDue === 1 ? '' : 's'}`, reason: 'Open the Practice Hub and start due-card review.' });
            else if (topFocusKey) actions.push({ id: 'generate_focus_drill', label: `Generate ${topFocusTitle}`, reason: 'Turn the top notebook focus into a fresh drill.', focus_key: topFocusKey });
        } else if (prompt.includes('notebook') || prompt.includes('lesson') || prompt.includes('coach')) {
            title = topFocusKey ? `Notebook plan for ${topFocusTitle}` : 'Use AI Notebook for explanation';
            reply = notebookOpen
                ? `AI Notebook is the better next move when you need explanation and pattern review. You have ${notebookOpen} open lesson${notebookOpen === 1 ? '' : 's'} waiting.`
                : 'Your AI Notebook is light right now, so the better move is another drill that creates stronger coach evidence.';
            actions.push({ id: 'open_ai_notebook', label: 'Open Coach Workspace', reason: 'Jump into the saved DeepSeek lessons on this dashboard.' });
            if (topFocusKey) actions.push({ id: 'generate_focus_drill', label: `Generate ${topFocusTitle}`, reason: 'Send this focus into a fresh practice drill.', focus_key: topFocusKey });
        } else if (recent?.title) {
            title = `Recover from ${recent.title}`;
            reply = `Your latest miss was ${recent.title}. Review that lesson once, then run a short guided drill before returning to mixed practice.`;
            actions.push({ id: 'open_ai_notebook', label: 'Open Coach Workspace', reason: 'Reopen the saved lesson on this dashboard.' });
            if (topFocusKey) actions.push({ id: 'apply_top_focus', label: `Guided Drill: ${topFocusTitle}`, reason: 'Launch a guided drill from the dashboard coach focus.', focus_key: topFocusKey });
        } else if (topFocusKey) {
            title = `Use ${topFocusTitle} as the next block`;
            reply = `The clearest next move is ${topFocusTitle}. Use a targeted drill first, then go back to assignments or mixed practice.`;
            actions.push({ id: 'apply_top_focus', label: `Guided Drill: ${topFocusTitle}`, reason: 'Launch the top coach focus from this dashboard.', focus_key: topFocusKey });
            actions.push({ id: 'generate_focus_drill', label: `Generate ${topFocusTitle}`, reason: 'Create a fresh practice set for the same focus.', focus_key: topFocusKey });
        } else {
            title = 'Open Practice Hub for the next block';
            reply = 'Start with a Practice Hub drill so DeepSeek has enough evidence to guide you with notebook and weak-area advice.';
            actions.push({ id: 'start_current_session', label: 'Open Practice Hub', reason: 'Jump to the drill builder and start a session.' });
        }

        return {
            source: 'fallback',
            mode: 'coach',
            title,
            topic: recent?.title || topFocusTitle || topic,
            message: reply,
            highlights: [wrongDue > 0 ? `${wrongDue} due in Wrong-bank` : '', notebookOpen > 0 ? `${notebookOpen} lesson${notebookOpen === 1 ? '' : 's'} open` : ''].filter(Boolean),
            sections: [
                { heading: 'Best next move', body: reply },
                { heading: 'Why this from the dashboard', body: 'The dashboard assistant routes you into the Practice Hub, coach workspace, and review surfaces without making you rebuild context.' }
            ],
            links: dashboardChatWikiLink(recent?.title || topFocusTitle || topic) ? [{ label: `Wikipedia: ${recent?.title || topFocusTitle || topic}`, url: dashboardChatWikiLink(recent?.title || topFocusTitle || topic), kind: 'wikipedia' }] : [],
            follow_ups: [
                { label: 'Make this more detailed', prompt: `${reply} Give me the more detailed version.` },
                { label: 'Turn this into a plan', prompt: 'Turn this into a short practice plan I can follow from the dashboard.' }
            ],
            quick_actions: normalizeDashboardChatActions(actions)
        };
    }

    async function requestDashboardChatReply(message) {
        const payload = {
            message: String(message || '').trim(),
            conversation: dashboardChat.messages
                .filter(entry => entry && ['user', 'assistant'].includes(entry.role))
                .slice(-8)
                .map(entry => ({ role: entry.role, content: String(entry.text || '').trim() }))
                .filter(entry => entry.content),
            study_context: buildDashboardChatContext(),
            assistant_mode: dashboardChat.ui.mode
        };
        const response = await fetch('/api/coach-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const raw = await response.json().catch(() => ({}));
        if (!response.ok && !raw?.message) throw new Error(`Coach chat failed (${response.status})`);
        const fallback = buildDashboardChatFallback(payload.message);
        return {
            source: String(raw?.source || '').trim().toLowerCase() === 'deepseek' ? 'deepseek' : fallback.source,
            mode: String(raw?.mode || '').trim() === 'knowledge' ? 'knowledge' : fallback.mode,
            title: String(raw?.title || '').trim() || fallback.title,
            topic: String(raw?.topic || '').trim() || fallback.topic,
            message: String(raw?.message || '').trim() || fallback.message,
            highlights: normalizeDashboardChatHighlights(raw?.highlights).length ? normalizeDashboardChatHighlights(raw?.highlights) : fallback.highlights,
            sections: normalizeDashboardChatSections(raw?.sections).length ? normalizeDashboardChatSections(raw?.sections) : fallback.sections,
            links: normalizeDashboardChatLinks(raw?.links).length ? normalizeDashboardChatLinks(raw?.links) : fallback.links,
            follow_ups: normalizeDashboardChatFollowUps(raw?.follow_ups).length ? normalizeDashboardChatFollowUps(raw?.follow_ups) : fallback.follow_ups,
            quick_actions: normalizeDashboardChatActions(raw?.quick_actions || fallback.quick_actions)
        };
    }

    function clearDashboardChatConversation() {
        dashboardChat.messages = [];
        dashboardChat.source = 'ready';
        renderDashboardChatChrome();
    }

    function setDashboardChatMode(mode = 'auto') {
        dashboardChat.ui.mode = ['auto', 'coach', 'knowledge'].includes(String(mode || '').trim()) ? String(mode).trim() : 'auto';
        saveDashboardChatUiPrefs();
        renderDashboardChatChrome();
    }

    function setDashboardChatSizePreset(size = 'standard') {
        const next = Object.prototype.hasOwnProperty.call(DASHBOARD_CHAT_SIZE_PRESETS, String(size || '').trim()) ? String(size).trim() : 'standard';
        dashboardChat.ui.size = next;
        dashboardChat.ui.width = clampDashboardChatWidth(DASHBOARD_CHAT_SIZE_PRESETS[next]);
        dashboardChat.ui.fullscreen = false;
        saveDashboardChatUiPrefs();
        renderDashboardChatChrome();
    }

    function toggleDashboardChatFullscreen() {
        dashboardChat.ui.fullscreen = !dashboardChat.ui.fullscreen;
        saveDashboardChatUiPrefs();
        renderDashboardChatChrome();
    }

    function beginDashboardChatResize(event) {
        if (window.innerWidth <= 900 || dashboardChat.ui.fullscreen) return;
        dashboardChat.resizing = { startX: event.clientX };
        document.body.classList.add('coach-chat-resizing');
        event.preventDefault();
    }

    async function sendDashboardChatMessage(rawMessage) {
        const message = String(rawMessage || '').trim();
        if (!message || dashboardChat.busy) return;
        dashboardChat.messages.push({ role: 'user', text: message, source: 'user', actions: [], highlights: [], sections: [], links: [], followUps: [] });
        dashboardChat.busy = true;
        dashboardChat.source = 'ready';
        renderDashboardChatChrome();
        try {
            const reply = await requestDashboardChatReply(message);
            dashboardChat.source = reply.source === 'deepseek' ? 'deepseek' : 'fallback';
            dashboardChat.messages.push({
                role: 'assistant',
                text: String(reply.message || '').trim(),
                source: dashboardChat.source,
                mode: String(reply.mode || '').trim() === 'knowledge' ? 'knowledge' : 'coach',
                title: String(reply.title || '').trim(),
                topic: String(reply.topic || '').trim(),
                highlights: Array.isArray(reply.highlights) ? reply.highlights : [],
                sections: Array.isArray(reply.sections) ? reply.sections : [],
                links: Array.isArray(reply.links) ? reply.links : [],
                followUps: Array.isArray(reply.follow_ups) ? reply.follow_ups : [],
                actions: normalizeDashboardChatActions(reply.quick_actions)
            });
        } catch (err) {
            const fallback = buildDashboardChatFallback(message);
            dashboardChat.source = 'fallback';
            dashboardChat.messages.push({
                role: 'assistant',
                text: String(fallback.message || '').trim(),
                source: 'fallback',
                mode: String(fallback.mode || '').trim() === 'knowledge' ? 'knowledge' : 'coach',
                title: String(fallback.title || '').trim(),
                topic: String(fallback.topic || '').trim(),
                highlights: Array.isArray(fallback.highlights) ? fallback.highlights : [],
                sections: Array.isArray(fallback.sections) ? fallback.sections : [],
                links: Array.isArray(fallback.links) ? fallback.links : [],
                followUps: Array.isArray(fallback.follow_ups) ? fallback.follow_ups : [],
                actions: normalizeDashboardChatActions(fallback.quick_actions)
            });
        } finally {
            dashboardChat.busy = false;
            if (dashboardChat.messages.length > 18) dashboardChat.messages.splice(0, dashboardChat.messages.length - 18);
            renderDashboardChatChrome();
        }
    }

    function openDashboardChat() {
        dashboardChat.suggestedReason = 'manual';
        dashboardChat.open = true;
        renderDashboardChatChrome();
        setTimeout(() => document.getElementById('coach-chat-input')?.focus(), 60);
    }

    function closeDashboardChat() {
        dashboardChat.open = false;
        renderDashboardChatChrome();
    }

    function writeDashboardCoachNavAction(mode, extra = {}) {
        try {
            localStorage.setItem(COACH_CHAT_NAV_STORAGE_KEY, JSON.stringify({ mode: String(mode || '').trim(), ts: Date.now(), ...extra }));
        } catch { /* noop */ }
    }

    function resolveDashboardChatFocus(action) {
        const focusKey = String(action?.focus_key || '').trim();
        if (focusKey) {
            const match = (Array.isArray(coachFocusSuggestionsCurrent) ? coachFocusSuggestionsCurrent : [])
                .find(focus => String(focus?.key || '').trim() === focusKey);
            if (match) return match;
        }
        return (Array.isArray(coachFocusSuggestionsCurrent) ? coachFocusSuggestionsCurrent[0] : null) || null;
    }

    async function runDashboardChatAction(action) {
        const actionId = String(action?.id || '').trim();
        const focus = resolveDashboardChatFocus(action);
        if (!DASHBOARD_CHAT_ALLOWED_ACTIONS.has(actionId)) return;
        if (actionId === 'open_ai_notebook') {
            activateDashboardTab('coach');
            await loadCoachWorkspace(false);
            return;
        }
        if (actionId === 'apply_top_focus') {
            if (!focus) { showAlert('No coach focus is ready yet.', 'error'); return; }
            closeDashboardChat();
            launchCoachGuidedDrill(focus, 'guided');
            return;
        }
        if (actionId === 'generate_focus_drill') {
            if (!focus) { showAlert('No coach focus is ready yet.', 'error'); return; }
            closeDashboardChat();
            launchCoachGuidedDrill(focus, 'generate');
            return;
        }
        if (actionId === 'practice_due_now' || actionId === 'review_last_misses' || actionId === 'open_review') {
            writeDashboardCoachNavAction(actionId);
            closeDashboardChat();
            window.location.href = 'index.html?drill=1';
            return;
        }
        if (actionId === 'open_library') {
            writeDashboardCoachNavAction('open_library', { query: String(action?.query || '').trim() });
            closeDashboardChat();
            window.location.href = 'index.html?drill=1';
            return;
        }
        closeDashboardChat();
        window.location.href = 'index.html?drill=1';
    }

    // ========== TAB SWITCHING ==========
    document.querySelectorAll('.dash-tab').forEach(tab => {
        tab.addEventListener('click', () => activateDashboardTab(tab.dataset.tab));
    });

    // ========== LOGOUT ==========
    document.getElementById('btn-logout').addEventListener('click', async (e) => {
        e.preventDefault(); await sb.auth.signOut(); window.location.replace('login.html');
    });

    document.getElementById('coach-chat-launcher')?.addEventListener('click', () => openDashboardChat());
    document.getElementById('coach-chat-new')?.addEventListener('click', clearDashboardChatConversation);
    document.getElementById('coach-chat-fullscreen')?.addEventListener('click', toggleDashboardChatFullscreen);
    document.getElementById('coach-chat-mode-switch')?.addEventListener('click', (event) => {
        const button = event.target.closest('.coach-chat-mode-btn');
        if (!button) return;
        setDashboardChatMode(button.dataset.mode || 'auto');
    });
    document.getElementById('coach-chat-size-presets')?.addEventListener('click', (event) => {
        const button = event.target.closest('.coach-chat-size-btn');
        if (!button) return;
        setDashboardChatSizePreset(button.dataset.size || 'standard');
    });
    document.getElementById('coach-chat-close')?.addEventListener('click', () => closeDashboardChat());
    document.getElementById('coach-chat-backdrop')?.addEventListener('click', () => closeDashboardChat());
    document.getElementById('coach-chat-resize-handle')?.addEventListener('pointerdown', beginDashboardChatResize);
    document.getElementById('coach-chat-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.getElementById('coach-chat-input');
        const message = String(input?.value || '').trim();
        if (!message) return;
        if (input) input.value = '';
        void sendDashboardChatMessage(message);
    });
    document.getElementById('coach-chat-workspace')?.addEventListener('click', (event) => {
        const button = event.target.closest('.coach-chat-workspace-card');
        if (!button) return;
        const card = dashboardChat.workspaceCards?.[Number(button.dataset.workspaceIndex) || 0];
        if (!card?.action) return;
        if (card.action.kind === 'mode') {
            setDashboardChatMode(card.action.mode || 'knowledge');
            return;
        }
        if (card.action.kind === 'prompt') {
            void sendDashboardChatMessage(card.action.prompt || '');
            return;
        }
        void runDashboardChatAction(card.action);
    });
    document.getElementById('coach-chat-starters')?.addEventListener('click', (event) => {
        const button = event.target.closest('.coach-chat-starter');
        if (!button) return;
        const starter = dashboardChat.currentStarters?.[Number(button.dataset.starterIndex) || 0];
        if (!starter?.prompt) return;
        void sendDashboardChatMessage(starter.prompt);
    });
    document.getElementById('coach-chat-messages')?.addEventListener('click', (event) => {
        const followUpButton = event.target.closest('.coach-chat-followup');
        if (followUpButton) {
            const messageIndex = Number(followUpButton.dataset.messageIndex);
            const followUpIndex = Number(followUpButton.dataset.followupIndex);
            const followUp = dashboardChat.messages?.[messageIndex]?.followUps?.[followUpIndex];
            if (followUp?.prompt) void sendDashboardChatMessage(followUp.prompt);
            return;
        }
        const toolButton = event.target.closest('.coach-chat-tool');
        if (toolButton) {
            const messageIndex = Number(toolButton.dataset.messageIndex);
            const message = dashboardChat.messages?.[messageIndex];
            if (message?.text) {
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(String(message.text || '').trim()).then(() => showAlert('Assistant answer copied', 'success')).catch(() => showAlert('Copy failed', 'error'));
                } else {
                    showAlert('Copy unavailable', 'error');
                }
            }
            return;
        }
        const button = event.target.closest('.coach-chat-action');
        if (!button) return;
        const messageIndex = Number(button.dataset.messageIndex);
        const actionIndex = Number(button.dataset.actionIndex);
        const action = dashboardChat.messages?.[messageIndex]?.actions?.[actionIndex];
        if (!action) return;
        void runDashboardChatAction(action);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && dashboardChat.open) {
            event.preventDefault();
            closeDashboardChat();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            dashboardChat.open ? closeDashboardChat() : openDashboardChat();
            return;
        }
        if (dashboardChat.open && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            toggleDashboardChatFullscreen();
            return;
        }
        if (event.key === 'Enter' && !event.shiftKey && document.activeElement?.id === 'coach-chat-input') {
            event.preventDefault();
            document.getElementById('coach-chat-form')?.requestSubmit();
        }
    });
    document.addEventListener('pointermove', (event) => {
        if (!dashboardChat.resizing) return;
        dashboardChat.ui.width = clampDashboardChatWidth(window.innerWidth - event.clientX - 16);
        dashboardChat.ui.size = 'custom';
        saveDashboardChatUiPrefs();
        renderDashboardChatChrome();
    });
    document.addEventListener('pointerup', () => {
        if (!dashboardChat.resizing) return;
        dashboardChat.resizing = null;
        document.body.classList.remove('coach-chat-resizing');
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
                <div class="item-copy">
                    <span class="item-title">${esc(c.name)}</span>
                    <span class="item-meta">Invite code ready for assignments and live play.</span>
                </div>
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
        const generateBtn = event.target.closest('.coach-focus-generate');
        if (generateBtn) {
            const focus = coachFocusSuggestionsCurrent[Number(generateBtn.dataset.focusIndex) || 0] || null;
            launchCoachGuidedDrill(focus, 'generate');
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
                    <div class="item-copy">
                        <span class="item-title">${esc(a.title)}</span>
                        <span class="item-meta">${esc(cls)} · Due: ${due}</span>
                    </div>
                    <span class="status-pill pending">Pending</span>
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
                    <div class="item-copy">
                        <span class="item-title">${esc(a.title)}</span>
                        <span class="item-meta">${esc(cls)} · Due: ${due}</span>
                    </div>
                    <span class="status-pill done">Completed</span>
                    <span class="item-score ${pct >= 50 ? 'good' : 'bad'}">${sub.correct}/${sub.total} (${pct}%)</span>
                    <div class="item-actions">
                        <button class="btn ghost" onclick="startAssignment('${a.id}', '${esc(a.title)}')">Redo</button>
                    </div>
                </div>`;
            }).join('');
        }

        // Update sub-tab labels with counts
        document.querySelectorAll('.assign-sub-tab').forEach(t => {
            if (t.dataset.sub === 'todo') t.textContent = `To Do · ${todoList.length}`;
            if (t.dataset.sub === 'completed') t.textContent = `Completed · ${doneList.length}`;
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
        if (!isNotebookCoachRecord(source)) return null;
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
        const raw = safeReadJson(KEY_COACH_LOCAL, []);
        const safe = (Array.isArray(raw) ? raw : []).filter(isNotebookCoachRecord).map(normalizeCoachRecord).filter(Boolean);
        if (Array.isArray(raw) && safe.length !== raw.length) writeCoachLocalRecords(safe);
        return safe;
    }

    function writeCoachLocalRecords(records) {
        try {
            localStorage.setItem(KEY_COACH_LOCAL, JSON.stringify((Array.isArray(records) ? records : []).filter(isNotebookCoachRecord).slice(0, 300)));
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
        const records = (Array.isArray(data) ? data : []).filter(isNotebookCoachRecord).map(normalizeCoachRecord).filter(Boolean);
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

    function launchCoachGuidedDrill(focus = null, mode = 'guided') {
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
                mode: String(mode || 'guided').trim() || 'guided',
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
                    <button class="btn ghost coach-focus-generate" type="button" data-focus-index="${index}">Generate Drill</button>
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
            renderDashboardChatChrome();
            return;
        }
        const primary = focuses[0];
        summaryEl.textContent = `Before your next assignment, put extra attention on ${primary.title}. The coach is seeing repeat friction there across your recent practice.`;
        renderCoachFocusCards('assignments-coach-focuses', focuses, 'No assignment prep suggestions yet.');
        renderDashboardChatChrome();
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
        renderDashboardChatChrome();
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

    function configureAnalyticsSvg(svg, width, height) {
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.classList.add('interactive');
    }

    function chartAxisLabel(value, options = {}) {
        if (typeof options.axisLabelFn === 'function') return options.axisLabelFn(value);
        if (typeof options.yLabelFn === 'function') return options.yLabelFn(value);
        return String(Math.round(value));
    }

    function chartTooltipLabel(value, options = {}) {
        if (typeof options.tooltipLabelFn === 'function') return options.tooltipLabelFn(value);
        return chartAxisLabel(value, options);
    }

    function pointerWithinChartPlot(point, width, height, pad) {
        return point.x >= pad.l && point.x <= width - pad.r && point.y >= pad.t && point.y <= height - pad.b;
    }

    function chartPointerPoint(event, svg, width, height) {
        const rect = svg.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (width / rect.width),
            y: (event.clientY - rect.top) * (height / rect.height),
            clientX: event.clientX,
            clientY: event.clientY
        };
    }

    function ensureAnalyticsChartTooltip(svg) {
        const shell = svg.closest('.analytics-chart-shell');
        if (!shell) return null;
        let tooltip = shell.querySelector('.analytics-chart-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'analytics-chart-tooltip';
            tooltip.setAttribute('aria-hidden', 'true');
            shell.appendChild(tooltip);
        }
        return tooltip;
    }

    function showAnalyticsChartTooltip(svg, clientX, clientY, label, value, detail = '') {
        const shell = svg.closest('.analytics-chart-shell');
        const tooltip = ensureAnalyticsChartTooltip(svg);
        if (!shell || !tooltip) return;
        tooltip.innerHTML = `
            <span class="analytics-chart-tooltip-label">${esc(label)}</span>
            <span class="analytics-chart-tooltip-value">${esc(value)}</span>
            ${detail ? `<span class="analytics-chart-tooltip-detail">${esc(detail)}</span>` : ''}
        `;
        tooltip.classList.add('is-visible');

        const shellRect = shell.getBoundingClientRect();
        const pad = 12;
        const anchorX = clientX - shellRect.left;
        const anchorY = clientY - shellRect.top;

        let left = anchorX + 16;
        let top = anchorY - tooltip.offsetHeight - 16;

        const minLeft = pad;
        const maxLeft = shell.clientWidth - tooltip.offsetWidth - pad;
        if (left > maxLeft) left = maxLeft;
        if (left < minLeft) left = minLeft;

        const minTop = pad;
        const maxTop = shell.clientHeight - tooltip.offsetHeight - pad;
        if (top < minTop) {
            top = anchorY + 16;
        }
        if (top > maxTop) top = maxTop;
        if (top < minTop) top = minTop;

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    function hideAnalyticsChartTooltip(svg) {
        const tooltip = ensureAnalyticsChartTooltip(svg);
        if (!tooltip) return;
        tooltip.classList.remove('is-visible');
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

        const w = 820, h = 320;
        const pad = { l: 56, r: 24, t: 28, b: 44 };
        const plotW = w - pad.l - pad.r;
        const plotH = h - pad.t - pad.b;
        const min = Number.isFinite(options.min) ? Number(options.min) : Math.min(...valid);
        const max = Number.isFinite(options.max) ? Number(options.max) : Math.max(...valid);
        const yMin = options.minZero ? Math.min(0, min) : min;
        const yMax = max === yMin ? yMin + 1 : max;
        const color = options.color || 'var(--accent)';
        const gradientId = `${svgId}-gradient`.replace(/[^a-zA-Z0-9_-]/g, '-');
        configureAnalyticsSvg(svg, w, h);

        const xFor = i => pad.l + (numeric.length <= 1 ? 0 : (i * plotW / (numeric.length - 1)));
        const yFor = v => pad.t + ((yMax - v) * plotH / (yMax - yMin));

        const gridTicks = 4;
        const grids = [];
        const yLabels = [];
        for (let t = 0; t <= gridTicks; t++) {
            const ratio = t / gridTicks;
            const y = pad.t + ratio * plotH;
            const value = yMax - ((yMax - yMin) * ratio);
            const text = chartAxisLabel(value, options);
            grids.push(`<line x1="${pad.l}" y1="${y.toFixed(2)}" x2="${w - pad.r}" y2="${y.toFixed(2)}" stroke="rgba(148,163,184,0.18)" stroke-width="1.2" />`);
            yLabels.push(`<text x="${pad.l - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="currentColor" opacity=".72" font-size="12">${esc(text)}</text>`);
        }

        let path = '';
        let open = false;
        const circles = [];
        const segments = [];
        let activeSegment = [];
        const validPoints = [];
        numeric.forEach((v, i) => {
            if (v === null) {
                if (activeSegment.length) segments.push(activeSegment);
                activeSegment = [];
                open = false;
                return;
            }
            const x = xFor(i);
            const y = yFor(v);
            path += open ? ` L ${x.toFixed(2)} ${y.toFixed(2)}` : ` M ${x.toFixed(2)} ${y.toFixed(2)}`;
            open = true;
            activeSegment.push({ index: i, x, y, value: v, label: labels[i] || '' });
            validPoints.push({ index: i, x, y, value: v, label: labels[i] || '' });
            circles.push(`<circle class="analytics-line-point" data-index="${i}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="6.2" fill="${color}" stroke="rgba(255,255,255,0.92)" stroke-width="2.2" />`);
        });
        if (activeSegment.length) segments.push(activeSegment);

        const areaPaths = segments.map(segment => {
            const first = segment[0];
            const last = segment[segment.length - 1];
            const line = segment.map((point, idx) => `${idx === 0 ? 'L' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
            return `<path d="M ${first.x.toFixed(2)} ${(h - pad.b).toFixed(2)} ${line} L ${last.x.toFixed(2)} ${(h - pad.b).toFixed(2)} Z" fill="url(#${gradientId})" opacity="0.88"></path>`;
        });

        const mid = Math.floor((labels.length - 1) / 2);
        const xLabels = [
            { i: 0, txt: labels[0] || '' },
            { i: mid, txt: labels[mid] || '' },
            { i: labels.length - 1, txt: labels[labels.length - 1] || '' }
        ].map(xl => `<text x="${xFor(xl.i).toFixed(2)}" y="${h - 10}" text-anchor="middle" fill="currentColor" opacity=".76" font-size="12">${esc(xl.txt)}</text>`);

        svg.innerHTML = `
            <defs>
                <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${color}" stop-opacity="0.26"></stop>
                    <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>
                </linearGradient>
            </defs>
            <rect x="0" y="0" width="${w}" height="${h}" fill="transparent"></rect>
            ${grids.join('')}
            ${yLabels.join('')}
            ${areaPaths.join('')}
            <path d="${path}" fill="none" stroke="${color}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round" opacity="0.16"></path>
            <path d="${path}" fill="none" stroke="${color}" stroke-width="4.6" stroke-linejoin="round" stroke-linecap="round"></path>
            ${circles.join('')}
            ${xLabels.join('')}
            <g class="analytics-hover-layer" opacity="0" pointer-events="none">
                <line class="analytics-chart-focus-line" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h - pad.b}" stroke="${color}" stroke-width="1.8" opacity="0.34" stroke-dasharray="5 6"></line>
                <circle class="analytics-chart-focus-halo" cx="${pad.l}" cy="${pad.t}" r="13" fill="${color}" opacity="0.18"></circle>
                <circle class="analytics-chart-focus-dot" cx="${pad.l}" cy="${pad.t}" r="7.4" fill="${color}" stroke="rgba(255,255,255,0.95)" stroke-width="2.4"></circle>
            </g>
        `;

        const hoverLayer = svg.querySelector('.analytics-hover-layer');
        const hoverLine = svg.querySelector('.analytics-chart-focus-line');
        const hoverHalo = svg.querySelector('.analytics-chart-focus-halo');
        const hoverDot = svg.querySelector('.analytics-chart-focus-dot');
        const pointEls = Array.from(svg.querySelectorAll('.analytics-line-point'));

        const clearHover = () => {
            hoverLayer?.setAttribute('opacity', '0');
            pointEls.forEach(el => el.classList.remove('is-active', 'is-dim'));
            hideAnalyticsChartTooltip(svg);
        };

        svg.onpointerleave = clearHover;
        svg.onpointermove = event => {
            const point = chartPointerPoint(event, svg, w, h);
            if (!pointerWithinChartPlot(point, w, h, pad)) {
                clearHover();
                return;
            }
            const nearest = validPoints.reduce((best, current) =>
                !best || Math.abs(current.x - point.x) < Math.abs(best.x - point.x) ? current : best, null);
            if (!nearest) {
                clearHover();
                return;
            }
            hoverLayer?.setAttribute('opacity', '1');
            hoverLine?.setAttribute('x1', nearest.x.toFixed(2));
            hoverLine?.setAttribute('x2', nearest.x.toFixed(2));
            hoverHalo?.setAttribute('cx', nearest.x.toFixed(2));
            hoverHalo?.setAttribute('cy', nearest.y.toFixed(2));
            hoverDot?.setAttribute('cx', nearest.x.toFixed(2));
            hoverDot?.setAttribute('cy', nearest.y.toFixed(2));
            pointEls.forEach(el => {
                const active = Number(el.getAttribute('data-index')) === nearest.index;
                el.classList.toggle('is-active', active);
                el.classList.toggle('is-dim', !active);
            });
            const rect = svg.getBoundingClientRect();
            showAnalyticsChartTooltip(
                svg,
                rect.left + ((nearest.x / w) * rect.width),
                rect.top + ((nearest.y / h) * rect.height),
                nearest.label || `Point ${nearest.index + 1}`,
                chartTooltipLabel(nearest.value, options),
                options.seriesName || ''
            );
        };
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

        const w = 820, h = 320;
        const pad = { l: 38, r: 24, t: 28, b: 44 };
        const plotW = w - pad.l - pad.r;
        const plotH = h - pad.t - pad.b;
        const bw = Math.max(10, plotW / vals.length * 0.8);
        const gap = Math.max(4, plotW / vals.length * 0.16);
        const color = options.color || 'var(--accent2)';
        const gradientId = `${svgId}-gradient`.replace(/[^a-zA-Z0-9_-]/g, '-');
        configureAnalyticsSvg(svg, w, h);

        const gridTicks = 4;
        const grids = [];
        const yLabels = [];
        for (let t = 0; t <= gridTicks; t++) {
            const ratio = t / gridTicks;
            const y = pad.t + ratio * plotH;
            const value = max - (max * ratio);
            grids.push(`<line x1="${pad.l}" y1="${y.toFixed(2)}" x2="${w - pad.r}" y2="${y.toFixed(2)}" stroke="rgba(148,163,184,0.16)" stroke-width="1.2" />`);
            yLabels.push(`<text x="${pad.l - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="currentColor" opacity=".72" font-size="12">${esc(chartAxisLabel(value, options))}</text>`);
        }

        const barsData = vals.map((v, i) => {
            const x = pad.l + i * (bw + gap);
            const hh = Math.max(2, (v / max) * plotH);
            const y = h - pad.b - hh;
            return {
                index: i,
                label: labels[i] || '',
                value: v,
                x,
                y,
                width: bw,
                height: hh,
                centerX: x + (bw / 2)
            };
        });
        const bars = barsData.map(bar => `<rect class="analytics-bar" data-index="${bar.index}" x="${bar.x.toFixed(2)}" y="${bar.y.toFixed(2)}" width="${bar.width.toFixed(2)}" height="${bar.height.toFixed(2)}" rx="9" fill="url(#${gradientId})" stroke="rgba(255,255,255,0.42)" stroke-width="1.4" opacity="0.94" />`);

        const mid = Math.floor((labels.length - 1) / 2);
        const xLabelPos = i => pad.l + i * (bw + gap) + (bw / 2);
        const xLabels = [
            { i: 0, txt: labels[0] || '' },
            { i: mid, txt: labels[mid] || '' },
            { i: labels.length - 1, txt: labels[labels.length - 1] || '' }
        ].map(xl => `<text x="${xLabelPos(xl.i).toFixed(2)}" y="${h - 10}" text-anchor="middle" fill="currentColor" opacity=".76" font-size="12">${esc(xl.txt)}</text>`);

        svg.innerHTML = `
            <defs>
                <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${color}" stop-opacity="0.98"></stop>
                    <stop offset="100%" stop-color="${color}" stop-opacity="0.54"></stop>
                </linearGradient>
            </defs>
            <rect x="0" y="0" width="${w}" height="${h}" fill="transparent"></rect>
            ${grids.join('')}
            ${yLabels.join('')}
            ${bars.join('')}
            ${xLabels.join('')}
            <g class="analytics-hover-layer" opacity="0" pointer-events="none">
                <rect class="analytics-bar-focus" x="${pad.l}" y="${pad.t}" width="${bw.toFixed(2)}" height="12" rx="10" fill="${color}" opacity="0.2"></rect>
            </g>
        `;

        const hoverLayer = svg.querySelector('.analytics-hover-layer');
        const hoverBar = svg.querySelector('.analytics-bar-focus');
        const barEls = Array.from(svg.querySelectorAll('.analytics-bar'));

        const clearHover = () => {
            hoverLayer?.setAttribute('opacity', '0');
            barEls.forEach(el => el.classList.remove('is-active', 'is-dim'));
            hideAnalyticsChartTooltip(svg);
        };

        svg.onpointerleave = clearHover;
        svg.onpointermove = event => {
            const point = chartPointerPoint(event, svg, w, h);
            if (!pointerWithinChartPlot(point, w, h, pad)) {
                clearHover();
                return;
            }
            const nearest = barsData.reduce((best, current) =>
                !best || Math.abs(current.centerX - point.x) < Math.abs(best.centerX - point.x) ? current : best, null);
            if (!nearest) {
                clearHover();
                return;
            }
            hoverLayer?.setAttribute('opacity', '1');
            hoverBar?.setAttribute('x', nearest.x.toFixed(2));
            hoverBar?.setAttribute('y', nearest.y.toFixed(2));
            hoverBar?.setAttribute('width', nearest.width.toFixed(2));
            hoverBar?.setAttribute('height', nearest.height.toFixed(2));
            barEls.forEach(el => {
                const active = Number(el.getAttribute('data-index')) === nearest.index;
                el.classList.toggle('is-active', active);
                el.classList.toggle('is-dim', !active);
            });
            const rect = svg.getBoundingClientRect();
            showAnalyticsChartTooltip(
                svg,
                rect.left + ((nearest.centerX / w) * rect.width),
                rect.top + ((nearest.y / h) * rect.height),
                nearest.label || `Bar ${nearest.index + 1}`,
                chartTooltipLabel(nearest.value, options),
                options.seriesName || ''
            );
        };
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

    function renderAnalyticsHero(snapshot) {
        const titleEl = document.getElementById('analytics-hero-title');
        const summaryEl = document.getElementById('analytics-hero-summary');
        const activeEl = document.getElementById('analytics-hero-active-days');
        const fastestEl = document.getElementById('analytics-hero-fastest');
        if (titleEl) {
            if (snapshot.totalAttempts <= 0) {
                titleEl.textContent = 'Your last 30 days at a glance';
            } else if (snapshot.totalAccuracy >= 80) {
                titleEl.textContent = 'Your recent drill rhythm is holding up well.';
            } else if (snapshot.totalAccuracy >= 65) {
                titleEl.textContent = 'Your analytics show a workable base with a few leaks.';
            } else {
                titleEl.textContent = 'Your weakest slices are visible enough to attack directly.';
            }
        }
        if (summaryEl) {
            summaryEl.textContent = snapshot.totalAttempts > 0
                ? `You answered ${snapshot.totalAttempts.toLocaleString()} questions across ${snapshot.sessionsCount} sessions. Read the charts first, then use the blind-spot panels to decide what deserves a focused drill.`
                : 'Track volume, accuracy, and buzz timing before you move on to AI interpretation.';
        }
        if (activeEl) activeEl.textContent = `${snapshot.activeDays || 0} / 30`;
        if (fastestEl) fastestEl.textContent = snapshot.fastestBuzz ? `${snapshot.fastestBuzz.toFixed(2)}s` : '—';
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
        renderAnalyticsHero(snapshot);
        prepareAnalyticsInsights(snapshot, hasData);
        if (!hasData) {
            renderDashboardChatChrome();
            return;
        }

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
            {
                min: 0,
                max: 100,
                color: '#60a5fa',
                yLabelFn: v => `${Math.round(v)}%`,
                tooltipLabelFn: v => `${Math.round(v)}% accuracy`,
                seriesName: 'Accuracy trend',
                emptyText: 'No accuracy data'
            }
        );
        renderLineChart(
            'analytics-chart-buzz',
            snapshot.days.map(d => d.avgBuzz),
            labels,
            {
                minZero: true,
                color: '#22c55e',
                yLabelFn: v => `${v.toFixed(1)}s`,
                tooltipLabelFn: v => `${v.toFixed(2)}s average buzz`,
                seriesName: 'Buzz speed trend',
                emptyText: 'No buzz speed data'
            }
        );
        renderBarChart(
            'analytics-chart-volume',
            snapshot.days.map(d => d.attempts),
            labels,
            {
                color: '#f59e0b',
                axisLabelFn: v => `${Math.round(v)}`,
                tooltipLabelFn: v => `${Math.round(v)} questions answered`,
                seriesName: 'Daily volume',
                emptyText: 'No attempts yet'
            }
        );

        renderPerformanceList('analytics-era-list', snapshot.eraStats, 'No era-tagged questions yet.');
        renderPerformanceList('analytics-region-list', snapshot.regionStats, 'No region-tagged questions yet.');
        renderBlindSpots(snapshot.blindSpots);
        renderHeatmap(snapshot.days, snapshot.activeDays, snapshot.fastestBuzz);
        renderDashboardChatChrome();
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
    renderDashboardChatChrome();
});
